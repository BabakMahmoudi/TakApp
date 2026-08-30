# AGENTS.md

## Project Overview

TakApp is a non-custodial wallet for the Stellar blockchain, delivered as a Progressive Web App (PWA). Users pay in the project's own token, **TAK** (issued on Stellar), to buy coffee in selected local coffee shops. The app also supports XLM and establishes a TAK trustline.

A companion **Telegram bot** gives users an LLM-driven, natural-language experience (e.g., "show my balance", "where can I pay?") powered by **DeepSeek** as the LLM. The bot is **read-only for v1**: balances, shop list, and history. Payment execution stays in the PWA until Telegram MiniApp work is scheduled.

This file guides AI agents and human contributors working in this repository. Read it before making changes.

## Tech Stack

| Concern | Choice |
| --- | --- |
| Repo layout | pnpm workspaces monorepo: `apps/web`, `apps/bot`, `packages/shared` |
| Language | TypeScript (strict mode) |
| Framework | Next.js 15 (App Router), React 19 |
| PWA tooling | `@serwist/next` (manifest + service worker + offline shell) |
| Styling | Tailwind CSS v4 |
| RPC layer | tRPC v11 (+ `@tanstack/react-query`, Zod validation) |
| Hosting | Cloudflare Workers (deploy via OpenNext `@opennextjs/cloudflare`) |
| Database | Cloudflare D1 (SQLite) |
| ORM | Drizzle |
| Package manager | pnpm 10 |
| Runtime | Node 22 LTS |
| Blockchain | Stellar (`@stellar/stellar-sdk`), SEP-10 authentication, testnet for dev |
| Account activation | Server-held funding account (secret in env; funds activation + TAK issuance; never touches user balances) |
| Verification (v1) | TOTP (`otplib`) + pluggable `VerificationProvider` interface (email/SMS stubbed) |
| Client app | PWA (offline-capable, installable) |
| Telegram bot | grammY (webhook, Cloudflare Workers adapter), read-only for v1 |
| LLM | DeepSeek via `openai` SDK, model `deepseek-chat` |
| Task orchestration | Plain pnpm `--filter`/`-r` scripts (no Turborepo) |
| Lint/format | ESLint flat config + Prettier |
| Money | Strings in stroops (1 lumen = 10,000,000 stroops); never floats |

## Commands

> Run from the repo root.

```bash
pnpm install          # install dependencies
pnpm build            # production build (once before the first pnpm dev; re-run after server code changes)
pnpm dev              # preview the web worker locally (OpenNext + wrangler, D1 local)
pnpm dev:bot          # start the Telegram bot webhook listener locally
pnpm typecheck        # TypeScript type checking
pnpm lint             # lint (ESLint)
pnpm test             # run tests (Vitest)
pnpm db:generate      # generate Drizzle migrations
pnpm db:migrate       # apply Drizzle migrations to local D1
pnpm deploy           # deploy the workers to Cloudflare
```

> `opennextjs-cloudflare preview` serves the last `.open-next` build and does **not** rebuild after server code changes. If you edit `src/server/**` and `pnpm dev` seems to ignore it, run `pnpm build` first. The built worker also surfaces every signup step via `[signup]`/`[funding]`/`[trpc]` log markers; call `/api/trpc/auth.diagnostics` to probe Horizon and D1 reachability from inside the worker.


## Code Conventions

- TypeScript strict mode. Avoid `any`; use `unknown` and narrow explicitly.
- Server-side code only: never import `@stellar/stellar-sdk` client-side unless it is only used in a Web Worker that signs locally.
- Secrets and keys never leave the device: encryption keys, recovery phrases, and Stellar secret keys must never be sent to or persisted on the server in plaintext.
- Prefer tRPC procedures over REST endpoints. All client-server communication goes through tRPC.
- Database access goes exclusively through Drizzle; no raw SQL unless Drizzle cannot express it.
- Use the existing Drizzle schema as the single source of truth for DB types; derive `typeof` types rather than duplicating interfaces.
- All money/balance values are stored and compared as string representations of lumens (stroops-aware). Never use floating point for token amounts.
- Keep pnpm as the package manager. Commit `pnpm-lock.yaml`. Do not introduce `npm`/`yarn` artifacts.
- No comments unless they explain "why" (not "what").

## Project Structure

```
apps/
  web/                     # Next.js 15 App Router PWA (OpenNext Cloudflare Worker)
    src/app/               # routes + PWA shell + manifest + service worker
    src/app/api/trpc/      # tRPC fetch adapter route handler
    src/server/trpc/       # tRPC router definitions + context (auth + D1)
    src/server/stellar/    # Horizon client, SEP-10 helpers, funding helper, TAK asset
    src/lib/               # client crypto (WebCrypto/PBKDF2), recovery, tRPC provider
  bot/                     # Telegram bot (grammY webhook Cloudflare Worker, read-only)
    src/llm/               # DeepSeek integration, intent parsing/prompt templates
    src/intent/            # restricted command set (balance, shops, history)
packages/
  shared/                  # shared between the web and bot workers
    src/db/                # Drizzle client + schema (single source of truth for DB types)
    src/money/             # string-based stroop helpers
    src/zod-schemas/       # signup, SEP-10 challenge, balance, bot intent schemas
    src/verification/      # VerificationProvider interface + TOTP + email/SMS stubs
```

## Important Constraints

- **Non-custodial**: the server can never move user funds. It holds no user secret keys. Admin operations never touch user balances.
- **Funding account (bounded zero-key exception)**: the server holds exactly one Stellar secret key (`FUNDING_SECRET`, env only). It is used only to fund new accounts (`createAccount`) and issue TAK. It can never sign user transactions or touch user balances.
- **SEP-10 auth**: authentication must follow Stellar SEP-10 (challenge/response). Users sign challenges locally with their decrypted key; the server verifies signatures and issues a signed token.
- **Cloudflare D1 limitations**: SQLite-based; keep transactions short, batch writes, and be aware of D1's per-request write limits.
- **Cloudflare compatibility**: Next server code must avoid Node-only APIs; verify native modules (`argon2`) and edge crypto (`jose`, Stellar SDK) work on Workers. Server-side password hashing uses Web Crypto PBKDF2-SHA256 (native on Workers); do not reintroduce hash-wasm/WASM-compiled KDFs (workerd disallows runtime WASM compilation and pure-JS argon2 blocks the event loop).
- **PWA requirements**: core flows (login, balance view, pay) must work offline with sensible caching. Do not break service-worker compatibility with server-only dependencies in client bundles.
- **Verification**: only verified users receive free gifts. Email, SMS, and Google Authenticator (TOTP) are all supported verification methods; design verification as a pluggable set of providers.
- **Telegram bot security**: the bot executes **read-only** wallet actions (balance, shop list, history) only after the user's Telegram identity is bound and authorized. Payment execution stays in the PWA until Telegram MiniApp work is scheduled. LLM prompts and responses never receive or contain secret keys, recovery phrases, or signed transactions.
- **LLM safety**: treat DeepSeek output as untrusted input. Never let free-form LLM text drive privileged actions directly; parse intent into a restricted, validated command set before execution.

## Workflow

- Follow the architecture described in `ARCHITECTURE.md`. If a change conflicts with it, update that document in the same change.
- Every feature that touches balances, keys, or auth must include tests covering the failure paths (insufficient funds, wrong password, expired challenge, tampered request).
- Before committing: run `pnpm typecheck`, `pnpm lint`, and the relevant tests.
