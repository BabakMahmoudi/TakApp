# TakApp

Non-custodial Stellar wallet, delivered as a PWA, for paying coffee with the **TAK** token. A read-only Telegram bot adds a natural-language assistant powered by DeepSeek.

## Repo layout

```
apps/
  web/       Next.js 15 PWA (Cloudflare Worker via OpenNext, Serwist, tRPC, D1)
  bot/       Telegram bot (grammY webhook Worker, read-only, DeepSeek intent parsing)
packages/
  shared/    Drizzle schema, stroop money helpers, zod schemas, verification providers
```

## Prerequisites

- Node 22 LTS, pnpm 10
- A Cloudflare account (only needed for `deploy` / remote D1)

## Getting started

```bash
pnpm install
pnpm build         # required once: OpenNext preview serves the built worker
pnpm dev           # web worker locally (OpenNext preview + wrangler, D1 local)
pnpm dev:bot       # bot webhook worker locally
```

`pnpm dev` previews the last build (no HMR); use `pnpm --filter @takapp/web dev:next`
(`next dev`) for fast iteration without the worker runtime.

Note: the repo pins `node-linker=hoisted` in `.npmrc` — Next.js standalone output cannot
recreate pnpm's store symlinks on stock Windows (EPERM without Developer Mode), so packages
are installed as real directories.

Before the testnet thin slice works, set `apps/web/.dev.vars` (see `.dev.vars.example`):

- `FUNDING_SECRET` — a testnet funding account. Create one, then fund it via
  Friendbot before smoke tests:
  `curl "https://friendbot.stellar.org?addr=<PUBLIC_KEY>"`
- `JWT_SECRET` — random string of at least 32 chars.
- `TAK_CONTRACT_ID` — the SEP-41 Soroban TAK token contract address
  (`CBI3WR5NQZUQ5PAPV4TBCOFMJ3MOJVZVMH5CKCGVOP63YV2SPFZN3Z7C` on testnet), used for balance reads and transfers.
- `SOROBAN_RPC_URL` — the Soroban RPC endpoint (e.g. `https://soroban-testnet.stellar.org`).
- `HORIZON_PUBLIC_URL` / `SOROBAN_PUBLIC_RPC_URL` (optional) — override the client-facing
  Stellar endpoints. When unset, the client reaches Stellar through the same-origin proxy
  (`/api/stellar/horizon` and `/api/stellar/soroban`), which the worker forwards to
  `HORIZON_URL` / `SOROBAN_RPC_URL`.

Then apply the D1 schema locally:

```bash
pnpm db:generate   # Drizzle migration from packages/shared/src/db/schema.ts
pnpm db:migrate    # apply to local D1
```

## Commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Preview web worker locally (build first; wrangler + D1) |
| `pnpm dev:proxy` | Local Stellar forward proxy for filtered regions (run alongside `pnpm dev`) |
| `pnpm dev:bot` | Telegram bot webhook listener locally |
| `pnpm build` | Production build (both workers) |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm lint` | ESLint (flat config) |
| `pnpm test` | Vitest unit tests |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:migrate` | Apply migrations to local D1 |
| `pnpm deploy` | Deploy workers to Cloudflare |

## Thin slice (testnet)

The scaffold acceptance flow: signup → server funds the new account from the funding account →
SEP-10 login → balance read (XLM from Horizon, TAK from Soroban RPC, both as stroop strings).

## Network proxy / filtered regions

The PWA's payment flow talks to Horizon and Soroban RPC from the browser. In regions where
those endpoints are filtered, the app routes that traffic through its own origin instead:

- **Production** — automatic. `wallet.networkConfig` returns same-origin proxy URLs
  (`/api/stellar/horizon`, `/api/stellar/soroban`), and the worker forwards them to
  `HORIZON_URL` / `SOROBAN_RPC_URL` from the edge. Set `HORIZON_PUBLIC_URL` /
  `SOROBAN_PUBLIC_RPC_URL` to point the client elsewhere instead.
- **Local dev** — run `pnpm --filter @takapp/web dev:proxy` alongside `pnpm dev`, and set
  `HORIZON_URL=http://localhost:8788/horizon` and
  `SOROBAN_RPC_URL=http://localhost:8788/soroban` in `apps/web/.dev.vars`. The proxy tunnels
  outbound HTTPS through `STELLAR_DEV_FORWARD_PROXY` (default `http://localhost:2352`; set to
  `direct` to connect directly).

See `ARCHITECTURE.md` for the full design and `AGENTS.md` for contribution conventions.
