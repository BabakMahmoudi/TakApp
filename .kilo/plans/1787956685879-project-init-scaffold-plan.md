# TakApp — Project Initiation & Scaffolding Plan

## Context

Empty repo (`README.md` stub only). `AGENTS.md` and `ARCHITECTURE.md` exist but predate the finalized decisions below and must be synced before/during scaffolding.

## Locked Decisions

| Decision | Choice |
| --- | --- |
| Repo layout | pnpm workspaces monorepo: `apps/web`, `apps/bot`, `packages/shared` |
| Framework | Next.js 15 (App Router) + React 19 |
| PWA tooling | `@serwist/next` (manifest + service worker + offline shell) |
| Styling | Tailwind CSS v4 |
| RPC | tRPC v11 (+ `@tanstack/react-query`, Zod validation) |
| Hosting | Cloudflare Workers via OpenNext `@opennextjs/cloudflare` |
| Database | Cloudflare D1 + Drizzle ORM + `drizzle-kit` |
| Blockchain | Stellar (`@stellar/stellar-sdk`), testnet for dev, SEP-10 auth |
| Account activation | Server-held funding account (secret in env; funds activation + TAK issuance; never touches user balances) |
| Verification (v1) | TOTP (`otplib`) implemented + pluggable `VerificationProvider` interface (email/SMS stubbed) |
| Bot | grammY (webhook, Cloudflare Workers adapter) |
| Bot scope (v1) | Read-only: balance, shop list, history. No signing in Telegram (MiniApp signing deferred) |
| LLM | DeepSeek via `openai` SDK with `baseURL: https://api.deepseek.com`, model `deepseek-chat` |
| Task orchestration | Plain pnpm `--filter`/`-r` scripts (no Turborepo) |
| Runtime | Node 22 LTS, pnpm 10, TypeScript strict, ESLint flat config + Prettier |
| Money | Strings in stroops (1 lumen = 10,000,000 stroops); never floats |
| Scaffold scope | Foundation + thin vertical slice (below) |

**Thin slice (working end-to-end on testnet):** signup → server funds new account → client establishes TAK trustline → SEP-10 login → balance read (XLM + TAK). Bot: webhook handler + DeepSeek ping + read-only balance command. Payments, verification UIs, admin, coffee-shop flows, MiniApp are **out of scope** (skeleton/placeholders only).

## Task List

### M0 — Sync documents (do first)

Update `AGENTS.md`:
- Stack table: replace "grammY or telegraf" with **grammY**; add monorepo, Tailwind v4, Serwist rows.
- Replace the "Project Structure (intended)" block with the monorepo layout below.
- Amend bot constraint: **read-only for v1** (balances/queries only); payment execution is PWA-only until Telegram MiniApp work is scheduled.
- Add server funding account as a bounded zero-key exception.

Update `ARCHITECTURE.md`:
- Goals + "Conversational assistant" flow: bot executes read-only commands only.
- Components/diagram: add `packages/shared`, funding account, grammY bot worker.
- Technology decisions: add monorepo, Serwist, Tailwind v4, funding account, TOTP-first, DeepSeek via OpenAI SDK.
- Security model: document funding account exception (funds activation only, never user balances).
- Deployment: two Workers + shared package, env vars include `FUNDING_SECRET`, `BOT_TOKEN`, `DEEPSEEK_API_KEY`.
- Key flows: add "Account activation" (funding account sends `createAccount`); note MiniApp as future bot-payment path.

### M1 — Workspace foundation

- Root: `pnpm-workspace.yaml`, `package.json` (private, scripts), `tsconfig.base.json` (strict, `unknown` default), `.gitignore` (node_modules, .wrangler, .dev.vars, dist/.next), `.npmrc`, Prettier + ESLint flat config, `vitest` workspace config.
- Root scripts: `dev`, `dev:bot`, `build`, `typecheck`, `lint`, `test`, `db:generate`, `db:migrate`, `deploy` (using `--filter`/`-r`).
- Pin versions: Node 22 LTS (engines), pnpm 10.

### M2 — `packages/shared`

- `src/db/schema.ts` (Drizzle, single source of truth for DB types): `users`, `sessions`, `verifications`, `telegram_bindings`, `conversations`, `coffee_shops`, `payments`, `gifts` per ARCHITECTURE.md. All money columns are `text` (stroops).
- `src/money.ts`: string-based stroop helpers (parse/format/compare), no floats.
- `src/zod-schemas.ts`: signup, SEP-10 challenge, balance, intent (read-only command set: `balance`, `shops`, `history`).
- `src/verification/provider.ts`: `VerificationProvider` interface + `totp` implementation + `email`/`sms` stubs.
- Tests: money edge cases, TOTP verify/reject.

### M3 — `apps/web` foundation

- Scaffold Next.js 15 + TS strict; add `@opennextjs/cloudflare` + `wrangler.toml` (main binding, `D1` binding, `d1_databases`), `open-next.config.ts`, `drizzle.config.ts`.
- Tailwind v4 via `@tailwindcss/postcss`; coffee-themed base palette + PWA shell (`app/layout.tsx`, home, minimal nav).
- `@serwist/next` config in `next.config.ts`; `app/manifest.ts`; icons; offline shell covers home + balance.
- tRPC: server router in `src/server/trpc` (root router, context with auth + D1), fetch adapter route handler (`app/api/trpc/[trpc]/route.ts`); client provider (`@trpc/react-query`) in `src/lib/trpc`.
- `src/lib/crypto`: WebCrypto PBKDF2 key derivation + AES-GCM encrypt/decrypt; `src/lib/recovery`: BIP-39 12-word generate/validate (`bip39`), derive Stellar keypair from seed.
- `src/server/stellar`: Horizon client (testnet), SEP-10 challenge build/verify (`Utils.buildChallengeTx` / `readChallengeTx`), funding helper (env `FUNDING_SECRET` → `createAccount`), TAK asset constants (code `TAK`, issuer env `TAK_ISSUER`, 7 decimals).

### M4 — Thin slice (testnet)

1. `auth.signup`: client generates keypair + mnemonic, encrypts secret with PBKDF2-derived key, stores encrypted blob in IndexedDB; server stores `users` row (email/phone, public key, argon2 password hash via `@node-rs/argon2` or `argon2` — verify Cloudflare-compatible) and funds the account.
2. Trustline: client signs `changeTrust(TAK)` locally in a Web Worker and submits to Horizon directly; server verifies on-chain.
3. `auth.login` (SEP-10): server issues challenge, client signs with decrypted key, server verifies and issues JWT (SEP-10) via `hono/jose` or `jose`; single-use, time-limited nonces in `sessions`.
4. `wallet.balance`: returns XLM + TAK as stroop strings from Horizon, behind SEP-10 token.
5. Local `.dev.vars`/`.env`: `HORIZON_URL` (testnet), `FUNDING_SECRET` (testnet account funded via Friendbot in dev), `TAK_ISSUER`, SEP-10 settings, JWT secret.

### M5 — `apps/bot`

- grammY bot with `webhookCallback(bot, 'cloudflare')` exported as a Worker `fetch` handler; own `wrangler.toml`.
- `src/llm`: DeepSeek client (`openai` SDK, `deepseek-chat`); strict prompt returns JSON intent restricted to the read-only command set; parse+validate via shared zod schemas.
- Commands: `/start` (identity binding via `telegram_bindings`), `balance` (calls tRPC read-only), `/ping` DeepSeek smoke test.
- Security: bot executes only read-only actions; no signing path; LLM output never reaches privileged code unvalidated.

### M6 — Tests, validation, initial commit

- Tests (Vitest): money, TOTP, crypto round-trip, mnemonic round-trip, SEP-10 verify/reject (expired/tampered), intent parser (valid/invalid/ambiguous), funding failure path (insufficient funding account balance).
- Validation: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; `wrangler dev` smoke: signup → funded → trustline → balance on testnet; bot webhook invoked locally (`wrangler dev` for bot worker).
- Commit all scaffold + synced docs as the initial commit (git repo already exists on `main`; include the four untracked docs).

## Risks / Failure Modes

- **Cloudflare compatibility**: Next server code must avoid Node-only APIs (OpenNext + Workers). Pin anything needing node to client-only or use edge-safe replacements.
- **D1 migration workflow**: use `drizzle-kit` with the `wrangler` driver; keep migrations in a tracked folder; `db:generate`/`db:migrate` must target local first, remote explicitly.
- **Funding account**: on testnet, fund the funding account via Friendbot before smoke-testing; rate limits apply.
- **SEP-10 on Workers**: challenge/verify must work without Node crypto assumptions — use `@stellar/stellar-sdk` and `jose` (edge-safe).
- **Serwist + Workers**: service worker must be emitted as a static asset by OpenNext; verify offline shell loads under `wrangler dev`.
- **DeepSeek cost/limits**: keep prompts tiny; read-only intent only; no secrets in prompts.

## Out of Scope (placeholders only)

Payments, TOTP verification UI, email/SMS delivery, coffee-shop/admin CRUD, Telegram MiniApp signing, games/lottery (idea.txt), mainnet deployment.

## Validation Plan

1. `pnpm install && pnpm typecheck && pnpm lint && pnpm test` green.
2. `pnpm dev` (`wrangler dev`): PWA shell renders, offline shell works.
3. Thin-slice smoke on testnet: signup → account funded → trustline confirmed on-chain → SEP-10 login → balance shows XLM + TAK.
4. Bot: `wrangler dev` for bot worker; POST a fake update → `/ping` responds; `balance` returns stroop string for bound user; unbound user gets bind prompt.
5. Docs (`AGENTS.md`/`ARCHITECTURE.md`) consistent with the Locked Decisions table.
