# Solana escrow program

Anchor 0.31.1 program for full-order classic SPL Token swaps. Instructions:

- `make(id, amount_offered, amount_requested)`: maker creates an escrow PDA and deposits offered tokens into its vault.
- `take()`: any taker pays the requested tokens to the maker and receives the offered tokens atomically.
- `cancel()`: the maker refunds an open vault.

The program validates PDA seeds, signer authority, mints, associated token accounts, and the classic Token Program. It returns any extra tokens sent to the vault to the maker, closes the vault and escrow state, and emits lifecycle events.

```sh
pnpm install
NO_DNA=1 anchor build
NO_DNA=1 anchor test --provider.cluster localnet --provider.wallet /path/to/local-wallet.json
```

See the root README for initial program-key synchronization, localnet setup, test token creation, and frontend integration.
