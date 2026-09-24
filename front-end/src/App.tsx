import { useCallback, useEffect, useMemo, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { PublicKey } from '@solana/web3.js'
import {
  ata, cancelOrder, CLUSTER, ESCROW_ACCOUNT_SIZE, formatAmount, listOrders, makeOrder,
  mintInfo, parseAmount, PROGRAM_ID, takeOrder, tokenBalance, TOKEN_ACCOUNT_SIZE,
} from './solana/client'
import type { Order } from './solana/client'
import './App.css'

type TokenView = { decimals: number; balance: bigint }
type Notice = { kind: 'success' | 'error'; message: string; signature?: string }

function short(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}
function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function App() {
  const { connection } = useConnection()
  const wallet = useWallet()
  const [orders, setOrders] = useState<Order[]>([])
  const [mintDetails, setMintDetails] = useState<Record<string, number>>({})
  const [offeredMint, setOfferedMint] = useState('')
  const [requestedMint, setRequestedMint] = useState('')
  const [amountOffered, setAmountOffered] = useState('')
  const [amountRequested, setAmountRequested] = useState('')
  const [offeredView, setOfferedView] = useState<TokenView | null>(null)
  const [filter, setFilter] = useState<'all' | 'mine'>('all')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [rent, setRent] = useState<{ escrow: number; ata: number } | null>(null)

  const refresh = useCallback(async () => {
    const next = await listOrders(connection)
    setOrders(next)
    const mints = [...new Set(next.flatMap((order) => [order.offeredMint.toBase58(), order.requestedMint.toBase58()]))]
    const result = await Promise.all(mints.map(async (mint) => [mint, (await mintInfo(connection, new PublicKey(mint))).decimals] as const))
    setMintDetails(Object.fromEntries(result))
  }, [connection])

  useEffect(() => {
    void Promise.resolve().then(refresh).catch((error: unknown) => setNotice({ kind: 'error', message: messageOf(error) }))
    const timer = setInterval(() => void refresh().catch(() => undefined), 15000)
    return () => clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    void Promise.all([
      connection.getMinimumBalanceForRentExemption(ESCROW_ACCOUNT_SIZE),
      connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE),
    ]).then(([escrow, ataRent]) => setRent({ escrow, ata: ataRent })).catch(() => undefined)
  }, [connection])

  useEffect(() => {
    if (!wallet.publicKey || !offeredMint) { queueMicrotask(() => setOfferedView(null)); return }
    let active = true
    void (async () => {
      const mint = new PublicKey(offeredMint.trim())
      const info = await mintInfo(connection, mint)
      const balance = await tokenBalance(connection, mint, wallet.publicKey!)
      if (active) setOfferedView({ decimals: info.decimals, balance })
    })().catch(() => { if (active) setOfferedView(null) })
    return () => { active = false }
  }, [connection, wallet.publicKey, offeredMint])

  const visibleOrders = useMemo(() =>
    filter === 'mine' ? orders.filter((order) => order.maker.equals(wallet.publicKey ?? PublicKey.default)) : orders,
    [filter, orders, wallet.publicKey])

  async function create() {
    if (!wallet.publicKey) return
    setBusy('make')
    setNotice(null)
    try {
      const offer = new PublicKey(offeredMint.trim())
      const request = new PublicKey(requestedMint.trim())
      if (offer.equals(request)) throw new Error('Choose two different token mints.')
      const [offerInfo, requestInfo] = await Promise.all([mintInfo(connection, offer), mintInfo(connection, request)])
      const offerAmount = parseAmount(amountOffered, offerInfo.decimals)
      const requestAmount = parseAmount(amountRequested, requestInfo.decimals)
      const balance = await tokenBalance(connection, offer, wallet.publicKey)
      if (balance < offerAmount) throw new Error('Insufficient token balance for this offer.')
      const signature = await makeOrder(connection, wallet, offer, request, offerAmount, requestAmount)
      setNotice({ kind: 'success', message: 'Escrow created and funded.', signature })
      setAmountOffered('')
      setAmountRequested('')
      await refresh()
    } catch (error) {
      setNotice({ kind: 'error', message: messageOf(error) })
    } finally {
      setBusy('')
    }
  }

  async function act(order: Order, action: 'take' | 'cancel') {
    if (!wallet.publicKey) return
    setBusy(order.address.toBase58())
    setNotice(null)
    try {
      if (action === 'take') {
        const balance = await tokenBalance(connection, order.requestedMint, wallet.publicKey)
        if (balance < BigInt(order.amountRequested.toString())) throw new Error('Insufficient requested tokens to take this order.')
      }
      const signature = action === 'take'
        ? await takeOrder(connection, wallet, order)
        : await cancelOrder(connection, wallet, order)
      setNotice({ kind: 'success', message: action === 'take' ? 'Exchange completed.' : 'Escrow cancelled and refunded.', signature })
      await refresh()
    } catch (error) {
      setNotice({ kind: 'error', message: messageOf(error) })
    } finally {
      setBusy('')
    }
  }

  const offerBalance = offeredView ? formatAmount(offeredView.balance, offeredView.decimals) : '—'

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">◈</span><span>Solana Escrow</span></div>
        <div className="top-actions"><span className="network"><span className="network-dot" />{CLUSTER === 'devnet' ? 'Devnet' : 'Localnet'}</span><WalletMultiButton /></div>
      </header>

      <main>
        <section className="intro">
          <div className="eyebrow">PEER-TO-PEER TOKEN EXCHANGE</div>
          <h1>Trade tokens with clear terms.</h1>
          <p>Create an offer, lock the tokens on-chain, and let another wallet complete the exchange in one transaction.</p>
          <div className="flow"><span>01 Create offer</span><b>→</b><span>02 Tokens in escrow</span><b>→</b><span>03 Take or cancel</span></div>
        </section>

        {notice && (
          <div className={`notice ${notice.kind}`} role="status">
            <span>{notice.message}</span>
            {notice.signature && (CLUSTER === 'devnet'
              ? <a href={`https://explorer.solana.com/tx/${notice.signature}?cluster=devnet`} target="_blank" rel="noreferrer" title={notice.signature}>Tx {short(notice.signature)} ↗</a>
              : <code title={notice.signature}>Tx {short(notice.signature)}</code>)}
            <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button>
          </div>
        )}

        <div className="workspace">
          <section className="panel create-panel">
            <div className="section-heading"><div><span className="section-kicker">NEW OFFER</span><h2>Create escrow</h2></div><span className="step-badge">01</span></div>
            <div className="form-grid">
              <label>Token you offer <input value={offeredMint} onChange={(event) => setOfferedMint(event.target.value)} placeholder="SPL token mint address" spellCheck={false} /></label>
              <label>Amount to lock <input value={amountOffered} onChange={(event) => setAmountOffered(event.target.value)} placeholder="0.00" inputMode="decimal" /></label>
              <div className="balance-line">Your balance: <strong>{offerBalance}</strong></div>
              <div className="exchange-arrow">↓</div>
              <label>Token you request <input value={requestedMint} onChange={(event) => setRequestedMint(event.target.value)} placeholder="SPL token mint address" spellCheck={false} /></label>
              <label>Amount to receive <input value={amountRequested} onChange={(event) => setAmountRequested(event.target.value)} placeholder="0.00" inputMode="decimal" /></label>
            </div>
            <div className="summary-box">
              <strong>Transaction review</strong>
              <p>Lock {amountOffered || '—'} units of {offeredMint ? short(offeredMint) : 'your token'} for {amountRequested || '—'} units of {requestedMint ? short(requestedMint) : 'the requested token'}.</p>
              <small>Fee payer: your wallet · Cluster: {CLUSTER} · New escrow + vault rent: {rent ? ((rent.escrow + rent.ata) / 1e9).toFixed(6) : '…'} SOL, plus network fee. Vault rent returns to you when the order closes.</small>
            </div>
            <button className="primary-button" type="button" disabled={!wallet.publicKey || !!busy || !offeredMint || !requestedMint || !amountOffered || !amountRequested} onClick={() => void create()}>
              {busy === 'make' ? 'Creating…' : 'Create offer'}
            </button>
            {!wallet.publicKey && <p className="helper">Connect your wallet to create an offer.</p>}
          </section>

          <section className="panel order-panel">
            <div className="section-heading"><div><span className="section-kicker">MARKETPLACE</span><h2>Open offers <span className="count">{orders.length}</span></h2></div><button className="refresh-button" type="button" onClick={() => void refresh()}>↻ Refresh</button></div>
            <div className="tabs"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All offers</button><button className={filter === 'mine' ? 'active' : ''} onClick={() => setFilter('mine')}>My offers</button></div>
            <div className="orders">
              {visibleOrders.length === 0 && <div className="empty">No open offers in this view yet.</div>}
              {visibleOrders.map((order) => {
                const own = !!wallet.publicKey && order.maker.equals(wallet.publicKey)
                const offered = formatAmount(order.amountOffered, mintDetails[order.offeredMint.toBase58()] ?? 0)
                const requested = formatAmount(order.amountRequested, mintDetails[order.requestedMint.toBase58()] ?? 0)
                const orderKey = order.address.toBase58()
                const receiveAta = wallet.publicKey ? ata(order.offeredMint, wallet.publicKey) : null
                return <article className="order-card" key={orderKey}>
                  <div className="order-top"><span className="order-tag">{own ? 'YOUR OFFER' : 'OPEN OFFER'}</span><span title={orderKey}>#{short(orderKey)}</span></div>
                  <div className="trade-line"><div><small>YOU RECEIVE</small><strong>{own ? requested : offered}</strong><code title={(own ? order.requestedMint : order.offeredMint).toBase58()}>{short((own ? order.requestedMint : order.offeredMint).toBase58())}</code></div><span className="swap-icon">⇄</span><div><small>YOU PAY</small><strong>{own ? offered : requested}</strong><code title={(own ? order.offeredMint : order.requestedMint).toBase58()}>{short((own ? order.offeredMint : order.requestedMint).toBase58())}</code></div></div>
                  <div className="order-footer"><span title={order.maker.toBase58()}>Maker {short(order.maker.toBase58())}</span><button type="button" disabled={!!busy || !wallet.publicKey} onClick={() => void act(order, own ? 'cancel' : 'take')}>{busy === orderKey ? 'Processing…' : own ? 'Cancel & refund' : 'Take offer'}</button></div>
                  {!own && <small className="rent-note">You pay {requested} requested tokens and network fees. Missing token accounts may require up to {rent ? ((3 * rent.ata) / 1e9).toFixed(6) : '…'} SOL rent. Receive account: {receiveAta ? short(receiveAta.toBase58()) : '—'}.</small>}
                </article>
              })}
            </div>
          </section>
        </div>
      </main>
      <footer>{CLUSTER === 'devnet' ? 'Devnet' : 'Localnet'} · SPL Token · Full-order exchange · Program {CLUSTER === 'devnet'
        ? <a href={`https://explorer.solana.com/address/${PROGRAM_ID.toBase58()}?cluster=devnet`} target="_blank" rel="noreferrer" title={PROGRAM_ID.toBase58()}>{short(PROGRAM_ID.toBase58())} ↗</a>
        : <span title={PROGRAM_ID.toBase58()}>{short(PROGRAM_ID.toBase58())}</span>}</footer>
    </div>
  )
}
export default App
