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

- `FUNDING_SECRET` / `TAK_ISSUER` — a testnet funding account. Create one, then fund it via
  Friendbot before smoke tests:
  `curl "https://friendbot.stellar.org?addr=<PUBLIC_KEY>"`
- `JWT_SECRET` — random string of at least 32 chars.

Then apply the D1 schema locally:

```bash
pnpm db:generate   # Drizzle migration from packages/shared/src/db/schema.ts
pnpm db:migrate    # apply to local D1
```

## Commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Preview web worker locally (build first; wrangler + D1) |
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
client establishes the TAK trustline (signed in a Web Worker, submitted to Horizon) → SEP-10
login → balance read (XLM + TAK as stroop strings).

See `ARCHITECTURE.md` for the full design and `AGENTS.md` for contribution conventions.
