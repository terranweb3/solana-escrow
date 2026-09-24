import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createMint,
  getAccount, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount,
  mintTo, transfer,
} from "@solana/spl-token";
import { expect } from "chai";
import { SolanaEscrow } from "../target/types/solana_escrow";

describe("solana_escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.solanaEscrow as Program<SolanaEscrow>;
  const maker = (provider.wallet as anchor.Wallet).payer;
  const taker = Keypair.generate();
  const stranger = Keypair.generate();
  let offeredMint: PublicKey;
  let requestedMint: PublicKey;
  let makerOffered: PublicKey;
  let takerRequested: PublicKey;
  let nextId = 1;

  const ata = (mint: PublicKey, owner: PublicKey) =>
    getAssociatedTokenAddressSync(mint, owner, true);
  const address = (id: number) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId,
    )[0];
  const accounts = (id: number) => {
    const escrow = address(id);
    return {
      escrow, vault: ata(offeredMint, escrow),
      maker: maker.publicKey, offeredMint, requestedMint,
      makerOffered, makerRequested: ata(requestedMint, maker.publicKey),
      taker: taker.publicKey, takerRequested, takerOffered: ata(offeredMint, taker.publicKey),
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
  };
  async function make(offered = 100, requested = 75, id = nextId++) {
    const a = accounts(id);
    await program.methods.make(new BN(id), new BN(offered), new BN(requested))
      .accountsPartial(a).rpc();
    return { id, a };
  }
  async function balance(key: PublicKey) {
    return Number((await getAccount(provider.connection, key)).amount);
  }
  async function fails(promise: Promise<unknown>) {
    let rejected = false;
    try { await promise; } catch { rejected = true; }
    expect(rejected).eq(true);
  }

  before(async () => {
    for (const signer of [taker, stranger]) {
      const signature = await provider.connection.requestAirdrop(signer.publicKey, 5e9);
      await provider.connection.confirmTransaction(signature, "confirmed");
    }
    offeredMint = await createMint(provider.connection, maker, maker.publicKey, null, 0);
    requestedMint = await createMint(provider.connection, maker, maker.publicKey, null, 0);
    makerOffered = (await getOrCreateAssociatedTokenAccount(provider.connection, maker, offeredMint, maker.publicKey)).address;
    takerRequested = (await getOrCreateAssociatedTokenAccount(provider.connection, maker, requestedMint, taker.publicKey)).address;
    await mintTo(provider.connection, maker, offeredMint, makerOffered, maker, 10000);
    await mintTo(provider.connection, maker, requestedMint, takerRequested, maker, 10000);
  });

  it("takes the full order atomically, returns donated surplus, and closes accounts", async () => {
    const { a } = await make();
    expect(await balance(a.vault)).eq(100);
    await transfer(provider.connection, maker, makerOffered, a.vault, maker, 7);
    const makerRequestedBefore = await provider.connection.getAccountInfo(a.makerRequested)
      ? await balance(a.makerRequested) : 0;
    const makerOfferedBefore = await balance(makerOffered);
    const takerRequestedBefore = await balance(takerRequested);
    const takerLamportsBefore = await provider.connection.getBalance(taker.publicKey);
    await program.methods.take().accountsPartial(a).signers([taker]).rpc();
    expect(await balance(a.makerRequested)).eq(makerRequestedBefore + 75);
    expect(await balance(a.takerOffered)).eq(100);
    expect(await balance(makerOffered)).eq(makerOfferedBefore + 7);
    expect(await balance(takerRequested)).eq(takerRequestedBefore - 75);
    expect(await provider.connection.getAccountInfo(a.escrow)).eq(null);
    expect(await provider.connection.getAccountInfo(a.vault)).eq(null);
    expect(await provider.connection.getBalance(taker.publicKey)).lt(takerLamportsBefore);
    await fails(program.methods.take().accountsPartial(a).signers([taker]).rpc());
  });

  it("cancels and refunds the entire vault, including donations", async () => {
    const { a } = await make();
    await transfer(provider.connection, maker, makerOffered, a.vault, maker, 9);
    const before = await balance(makerOffered);
    const makerLamportsBefore = await provider.connection.getBalance(maker.publicKey);
    await program.methods.cancel().accountsPartial(a).rpc();
    expect(await balance(makerOffered)).eq(before + 109);
    expect(await provider.connection.getAccountInfo(a.escrow)).eq(null);
    expect(await provider.connection.getAccountInfo(a.vault)).eq(null);
    expect(await provider.connection.getBalance(maker.publicKey)).gt(makerLamportsBefore);
    await fails(program.methods.cancel().accountsPartial(a).rpc());
  });

  it("rejects zero amounts, same mint, insufficient balance, and reused id", async () => {
    const id = nextId++;
    const a = accounts(id);
    await fails(program.methods.make(new BN(id), new BN(0), new BN(1)).accountsPartial(a).rpc());
    await fails(program.methods.make(new BN(id), new BN(1), new BN(0)).accountsPartial(a).rpc());
    await fails(program.methods.make(new BN(id), new BN(1), new BN(1)).accountsPartial({
      ...a, requestedMint: offeredMint,
    }).rpc());
    await fails(program.methods.make(new BN(id), new BN(99999999), new BN(1)).accountsPartial(a).rpc());
    await make(10, 10, id);
    await fails(program.methods.make(new BN(id), new BN(10), new BN(10)).accountsPartial(a).rpc());
    await program.methods.cancel().accountsPartial(a).rpc();
  });

  it("rejects unauthorized cancel and wrong mint or token account", async () => {
    const { a } = await make();
    await fails(program.methods.cancel().accountsPartial({
      ...a, maker: stranger.publicKey,
      makerOffered: ata(offeredMint, stranger.publicKey),
    }).signers([stranger]).rpc());
    await fails(program.methods.take().accountsPartial({
      ...a, requestedMint: offeredMint,
    }).signers([taker]).rpc());
    await fails(program.methods.take().accountsPartial({
      ...a, takerRequested: a.takerOffered,
    }).signers([taker]).rpc());
    expect(await balance(a.vault)).eq(100);
    await program.methods.cancel().accountsPartial(a).rpc();
  });

  it("keeps the vault funded when taker cannot pay", async () => {
    const { a } = await make(50, 20000);
    await fails(program.methods.take().accountsPartial(a).signers([taker]).rpc());
    expect(await balance(a.vault)).eq(50);
    await program.methods.cancel().accountsPartial(a).rpc();
  });
});
