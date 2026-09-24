# Solana Escrow frontend

React/Vite interface for the escrow program deployed on Solana devnet at `HoAHyRj4TbwrbyscbDRRY26EXH5TEyi8sdCPJLxLQ21n`. Connect a transaction-signing wallet to create, take, or cancel full-order classic SPL Token swaps. Open orders can be viewed without connecting a wallet.

## Devnet (default)

```sh
pnpm install
pnpm dev
```

The default RPC is `https://api.devnet.solana.com`. Configure your wallet for devnet and fund it with devnet SOL for transaction fees and account rent. Offered and requested mint addresses must be classic SPL Token mints on devnet. The public RPC can rate-limit requests; use a browser-safe devnet RPC if needed:

```sh
VITE_SOLANA_RPC_URL=https://your-browser-safe-devnet-rpc.example pnpm dev
```

Vite publishes `VITE_` variables in the client bundle. Do not put private credentials in the RPC URL.

## Deploy on Netlify

Import this repository from GitHub into Netlify. The root `netlify.toml` sets the base directory to `front-end`, runs `pnpm build`, and publishes `front-end/dist`. Node 24 and pnpm 9.12.2 are pinned in the frontend. The generated IDL and types are checked in, so the Netlify build does not need the Anchor toolchain.

The deployed app uses devnet by default. Leave `VITE_SOLANA_CLUSTER` unset, or set it to `devnet`. If the public devnet RPC is rate-limited, set `VITE_SOLANA_RPC_URL` in Netlify's build environment to a browser-accessible devnet HTTPS RPC URL, then redeploy. This URL is embedded in the public JavaScript bundle; do not use a private API key in it. Configure the browser wallet for devnet as well.

## Localnet development

Start the local validator with the program as described in the root README, then run:

```sh
VITE_SOLANA_CLUSTER=localnet pnpm dev
```

This connects to `http://127.0.0.1:8899`. You can set `VITE_SOLANA_RPC_URL` to a different endpoint for the selected cluster. After changing the program interface or program ID, run `pnpm sync:idl` to copy the generated IDL and TypeScript type into `src/solana/`. The checked-in IDL currently points to the deployed devnet program ID.
