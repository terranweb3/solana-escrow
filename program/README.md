# Solana escrow program

Anchor workspace for the on-chain program. The generated `initialize` instruction is a starter example; escrow instructions have not been implemented yet.

## Build

```sh
pnpm install
NO_DNA=1 anchor build
```

The workspace targets `localnet` in `Anchor.toml`. The generated program keypair stays in the ignored `target/deploy/` directory. Keep it locally if you want to preserve the same program ID across builds.

## Test locally

```sh
NO_DNA=1 anchor test
```

This starts a local test network and sends the example `initialize` transaction. Run it only when you intend to execute that local transaction.
