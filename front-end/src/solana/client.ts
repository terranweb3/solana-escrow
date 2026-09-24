import { AnchorProvider, BN, Program } from '@coral-xyz/anchor'
import {
  clusterApiUrl, Connection, PublicKey, SystemProgram, Transaction,
} from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID,
  TokenAccountNotFoundError, getAccount, getAssociatedTokenAddressSync, getMint,
} from '@solana/spl-token'
import type { WalletContextState } from '@solana/wallet-adapter-react'
import { Buffer } from 'buffer/'
import idl from './solana_escrow.json'
import type { SolanaEscrow } from './solana_escrow'

export const CLUSTER = import.meta.env.VITE_SOLANA_CLUSTER === 'localnet' ? 'localnet' : 'devnet'
export const RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL?.trim()
  || (CLUSTER === 'localnet' ? 'http://127.0.0.1:8899' : clusterApiUrl('devnet'))
export const PROGRAM_ID = new PublicKey(idl.address)
export const TOKEN_ACCOUNT_SIZE = 165
export const ESCROW_ACCOUNT_SIZE = 129

export type Order = {
  address: PublicKey
  id: BN
  maker: PublicKey
  offeredMint: PublicKey
  requestedMint: PublicKey
  amountOffered: BN
  amountRequested: BN
}

export function programFor(connection: Connection, wallet: WalletContextState) {
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error('Connect a wallet that supports transaction signing.')
  const provider = new AnchorProvider(connection, {
    publicKey: wallet.publicKey,
    signTransaction: wallet.signTransaction,
    signAllTransactions: wallet.signAllTransactions ?? (async () => { throw new Error('Wallet does not support batch signing.') }),
  }, { commitment: 'confirmed' })
  return new Program<SolanaEscrow>(idl as unknown as SolanaEscrow, provider)
}

export async function listOrders(connection: Connection): Promise<Order[]> {
  const program = new Program<SolanaEscrow>(idl as unknown as SolanaEscrow, { connection })
  const rows = await program.account.escrow.all()
  return rows.map(({ publicKey, account }) => ({ address: publicKey, ...account }))
}

export function escrowAddress(maker: PublicKey, id: BN) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), maker.toBuffer(), id.toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID,
  )[0]
}

export function ata(mint: PublicKey, owner: PublicKey) {
  return getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
}

export async function mintInfo(connection: Connection, address: PublicKey) {
  return getMint(connection, address, 'confirmed', TOKEN_PROGRAM_ID)
}

export async function tokenBalance(connection: Connection, mint: PublicKey, owner: PublicKey): Promise<bigint> {
  try {
    return (await getAccount(connection, ata(mint, owner), 'confirmed', TOKEN_PROGRAM_ID)).amount
  } catch (error) {
    if (!(error instanceof TokenAccountNotFoundError)) throw error
    return 0n
  }
}

export function parseAmount(value: string, decimals: number): bigint {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) throw new Error('Enter a positive decimal amount.')
  const [whole, fraction = ''] = value.split('.')
  if (fraction.length > decimals) throw new Error(`This token supports at most ${decimals} decimal places.`)
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction.padEnd(decimals, '0') || '0'))
  if (amount <= 0n || amount > 18446744073709551615n) throw new Error('Amount is outside the supported range.')
  return amount
}

export function formatAmount(amount: bigint | BN, decimals: number): string {
  const raw = BigInt(amount.toString())
  if (decimals === 0) return raw.toString()
  const divisor = 10n ** BigInt(decimals)
  const fraction = (raw % divisor).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${raw / divisor}${fraction ? `.${fraction}` : ''}`
}

async function send(connection: Connection, wallet: WalletContextState, transaction: Transaction): Promise<string> {
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error('Connect your wallet first.')
  const block = await connection.getLatestBlockhash('confirmed')
  transaction.feePayer = wallet.publicKey
  transaction.recentBlockhash = block.blockhash
  const signed = await wallet.signTransaction(transaction)
  const simulation = await connection.simulateTransaction(signed)
  if (simulation.value.err) {
    throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}\n${simulation.value.logs?.slice(-5).join('\n') ?? ''}`)
  }
  const signature = await connection.sendRawTransaction(signed.serialize())
  const confirmation = await connection.confirmTransaction({ signature, ...block }, 'confirmed')
  if (confirmation.value.err) throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`)
  return signature
}

export async function makeOrder(
  connection: Connection, wallet: WalletContextState,
  offeredMint: PublicKey, requestedMint: PublicKey,
  amountOffered: bigint, amountRequested: bigint,
): Promise<string> {
  if (!wallet.publicKey) throw new Error('Connect your wallet first.')
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const id = new BN(Array.from(bytes), 'le')
  const escrow = escrowAddress(wallet.publicKey, id)
  const program = programFor(connection, wallet)
  const transaction = await program.methods.make(id, new BN(amountOffered.toString()), new BN(amountRequested.toString()))
    .accountsPartial({
      maker: wallet.publicKey, offeredMint, requestedMint,
      makerOffered: ata(offeredMint, wallet.publicKey),
      escrow, vault: ata(offeredMint, escrow),
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    }).transaction()
  return send(connection, wallet, transaction)
}

export async function takeOrder(connection: Connection, wallet: WalletContextState, order: Order): Promise<string> {
  if (!wallet.publicKey) throw new Error('Connect your wallet first.')
  const program = programFor(connection, wallet)
  const transaction = await program.methods.take().accountsPartial({
    taker: wallet.publicKey, maker: order.maker,
    escrow: order.address, offeredMint: order.offeredMint,
    requestedMint: order.requestedMint,
    vault: ata(order.offeredMint, order.address),
    makerRequested: ata(order.requestedMint, order.maker),
    makerOffered: ata(order.offeredMint, order.maker),
    takerOffered: ata(order.offeredMint, wallet.publicKey),
    takerRequested: ata(order.requestedMint, wallet.publicKey),
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  }).transaction()
  return send(connection, wallet, transaction)
}

export async function cancelOrder(connection: Connection, wallet: WalletContextState, order: Order): Promise<string> {
  if (!wallet.publicKey) throw new Error('Connect your wallet first.')
  const program = programFor(connection, wallet)
  const transaction = await program.methods.cancel().accountsPartial({
    maker: wallet.publicKey, escrow: order.address,
    offeredMint: order.offeredMint,
    vault: ata(order.offeredMint, order.address),
    makerOffered: ata(order.offeredMint, wallet.publicKey),
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  }).transaction()
  return send(connection, wallet, transaction)
}
