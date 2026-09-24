# Solana Escrow

A peer-to-peer escrow for swapping two fungible tokens governed by the classic SPL Token program. The program is deployed on devnet; localnet remains available for tests. A maker locks an exact amount of one token and requests an exact amount of another. Any wallet with enough requested tokens can fill the whole order. The maker can cancel an open order. Both legs of a fill execute atomically.

## Project

- `program/`: Anchor 0.31.1 program, IDL, and integration tests.
- `front-end/`: React/Vite wallet interface and IDL-based client.
- The escrow PDA uses seeds `["escrow", maker, id (u64 little-endian)]`. Its associated token account is the vault. The program closes both accounts after a fill or cancellation and refunds their rent to the maker.
- Orders have no deadline or partial fills. Only the classic SPL Token program is supported; native SOL and Token-2022 are outside this version.

## Prerequisites

Install Rust, Solana CLI with `spl-token`, Anchor CLI 0.31.1, Node.js, and pnpm. The default Anchor provider now targets devnet with `~/.config/solana/bootcamp-devnet.json`. Use `--provider.cluster localnet --provider.wallet /path/to/local-wallet.json` for local tests. Keep private keys out of the repository.

A fresh checkout does not include `program/target/deploy/solana_escrow-keypair.json`. Keep a secure backup of this keypair to upgrade the existing devnet program. For a new local-only program ID, run `anchor keys sync` after the first build, then rebuild and sync the frontend IDL; this changes the ID away from the devnet deployment.

## Build and test

```sh
cd program
pnpm install
NO_DNA=1 anchor build
NO_DNA=1 anchor test --provider.cluster localnet --provider.wallet /path/to/local-wallet.json
```

`anchor test` starts a local validator, deploys the program, and runs the escrow integration suite. It tests full fills, cancellation, refunds, donated vault tokens, invalid inputs, authorization, token-account checks, duplicate open IDs, and insufficient balances.

## Deploy the program to devnet

Deployed and verified on devnet on **2026-09-24**:

- Program ID: `HoAHyRj4TbwrbyscbDRRY26EXH5TEyi8sdCPJLxLQ21n`
- Upgrade authority: `5goivnWahpibAejkR2nySvouRj5AKf11inWn94f84Red`
- Deployment slot: `503429868`
- Deployment transaction: [`364gG28GBJwtypNnzkJ9zM4TAZYvEKvQavX9gh3F4mQ8ha2K3g1h1jmFHPyDBNC1LSW1pbPPaa5yNj5qjc39FBgX`](https://explorer.solana.com/tx/364gG28GBJwtypNnzkJ9zM4TAZYvEKvQavX9gh3F4mQ8ha2K3g1h1jmFHPyDBNC1LSW1pbPPaa5yNj5qjc39FBgX?cluster=devnet) (finalized)
- Program account: [Solana Explorer](https://explorer.solana.com/address/HoAHyRj4TbwrbyscbDRRY26EXH5TEyi8sdCPJLxLQ21n?cluster=devnet)

From `program/`, run `NO_DNA=1 anchor build`, then `NO_DNA=1 anchor deploy` to upgrade this program with the same program keypair. The provider in `Anchor.toml` uses devnet and the devnet wallet above; `[programs.devnet]` matches the local deploy keypair and Rust `declare_id!`. Check the wallet balance with `solana balance --keypair ~/.config/solana/bootcamp-devnet.json --url devnet` before deploying.

## Run the web app on devnet

The frontend defaults to Solana devnet and the deployed program ID above. From `front-end/`, run `pnpm install` and `pnpm dev`. Connect a browser wallet configured for devnet, and use devnet SOL and two classic SPL token mints created on devnet. Localnet token balances and accounts do not exist on devnet. The default public RPC is rate-limited; for a browser-safe devnet RPC, set `VITE_SOLANA_RPC_URL` before starting Vite. Any `VITE_` value is embedded in the browser bundle, so do not use a private credential in that URL. See `front-end/README.md` for configuration.

## Run the web app on localnet

Keep a validator and the built program running in one terminal:

```sh
cd program
solana-test-validator --reset --ledger target/app-ledger --bpf-program HoAHyRj4TbwrbyscbDRRY26EXH5TEyi8sdCPJLxLQ21n target/deploy/solana_escrow.so
```

If `anchor keys sync` changed the program ID, use that new ID in the validator command. After each program rebuild, copy its generated IDL and types into the frontend, then start Vite in localnet mode:

```sh
cd front-end
pnpm install
pnpm sync:idl
VITE_SOLANA_CLUSTER=localnet pnpm dev
```

Open the Vite URL. Configure two browser wallets for localnet RPC `http://127.0.0.1:8899`. A wallet must support transaction signing. In localnet mode the app connects to that local RPC. Airdrop SOL to both wallet addresses for network fees and any token-account rent:

```sh
solana airdrop 5 <MAKER_WALLET_ADDRESS> --url http://127.0.0.1:8899
solana airdrop 5 <TAKER_WALLET_ADDRESS> --url http://127.0.0.1:8899
```

Create two classic SPL token mints using your local test wallet, then mint balances to it and transfer each token to the appropriate browser wallet. Repeat the commands with the second mint address:

```sh
spl-token create-token --url http://127.0.0.1:8899 --owner /path/to/local-wallet.json
spl-token create-account <MINT_ADDRESS> --url http://127.0.0.1:8899 --owner /path/to/local-wallet.json
spl-token mint <MINT_ADDRESS> 1000 --url http://127.0.0.1:8899 --owner /path/to/local-wallet.json
spl-token transfer <MINT_ADDRESS> 100 <BROWSER_WALLET_ADDRESS> --fund-recipient --allow-unfunded-recipient --url http://127.0.0.1:8899 --owner /path/to/local-wallet.json
```

Give the maker the offered token and the taker the requested token. In the app, the maker enters both mint addresses and amounts, reviews the transfer and localnet rent estimate, and creates an order. The taker switches wallets and takes the order; alternatively, the maker cancels it. The app simulates a signed transaction before broadcasting and refreshes open orders after confirmation.

The frontend queries active escrow accounts directly from localnet. Closed orders disappear from the list; the program emits create, take, and cancel events in transaction logs. The UI displays mint addresses rather than unverified token names.
