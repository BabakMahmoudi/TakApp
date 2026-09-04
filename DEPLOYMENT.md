# Deployment

This document describes how to deploy TakApp to Cloudflare. TakApp runs as two
Cloudflare Workers backed by one Cloudflare D1 database (SQLite), and it ships
in **two environments**: `preview` (staging) and `production`.

## What gets deployed

| Artifact | Worker name | Source | Build output |
| --- | --- | --- | --- |
| Web PWA (Next.js via OpenNext) | `takapp-web` | `apps/web` | `.open-next/worker.js` + `.open-next/assets` |
| Telegram bot (grammY webhook) | `takapp-bot` | `apps/bot` | `src/index.ts` (no build step) |
| D1 database (Drizzle) | `takapp-d1` | `packages/shared/src/db/schema.ts` | `apps/web/drizzle` migrations |

The two workers share the schema, zod schemas, money helpers, and verification
providers in `packages/shared`. The web worker's D1 binding and the bot worker's
D1 binding point at the same logical database (see environment mapping below).

## Environments: preview vs production

Wrangler *environments* isolate preview from production. Each worker is deployed
once per environment, with a distinct worker name (and therefore URL), its own
non-secret `[vars]`, its own secrets, and its own D1 database.

| | `preview` | `production` |
| --- | --- | --- |
| Web worker | `takapp-web-preview` | `takapp-web-production` |
| Bot worker | `takapp-bot-preview` | `takapp-bot-production` |
| D1 database | `takapp-d1-preview` | `takapp-d1-production` |
| Stellar network | Testnet (`horizon-testnet`, `soroban-testnet`) | Public network (mainnet) |
| Secrets | Testnet funding account, test bot token | Production funding account, production bot token |

Keep the preview environment on Stellar testnet. The production environment uses
the public Stellar network passphrase, Horizon, Soroban RPC, and the mainnet TAK
contract.

## Prerequisites

- Node 22 LTS and pnpm 10.
- A Cloudflare account with Workers and D1 enabled.
- Wrangler authenticated. Either:
  - `npx wrangler login`, or
  - set `CLOUDFLARE_API_TOKEN` (needs at minimum the **Workers Scripts:Edit** and
    **D1:Edit** permissions).
- A Telegram bot token (from @BotFather) for each environment, and a DeepSeek API key.
- A Stellar funding account: on testnet create one and fund it via Friendbot
  (`curl "https://friendbot.stellar.org?addr=<PUBLIC_KEY>"`); on mainnet fund it
  directly with XLM.

## One-time setup (per environment)

Do this once per environment (preview and production).

### 1. Create the D1 databases

```bash
npx wrangler d1 create takapp-d1-preview
npx wrangler d1 create takapp-d1-production
```

Record the `database_id` printed for each. It goes into the corresponding
`wrangler.toml` environment block below (the repo ships a placeholder
`00000000-0000-0000-0000-000000000000` that must be replaced).

### 2. Configure `wrangler.toml` environments

Add `[env.preview]` and `[env.production]` blocks to each worker's `wrangler.toml`.
Non-secret settings stay in `[vars]`; secrets are applied in step 3 via
`wrangler secrets`.

`apps/web/wrangler.toml`:

```toml
name = "takapp-web"
main = ".open-next/worker.js"
compatibility_date = "2026-08-01"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = ".open-next/assets"
binding = "ASSETS"

# Top-level d1 binding is used by local dev (`pnpm dev`, `pnpm db:migrate`).
[[d1_databases]]
binding = "DB"
database_name = "takapp-d1"
database_id = "00000000-0000-0000-0000-000000000000"
migrations_dir = "./drizzle"

[env.preview]
name = "takapp-web-preview"
[env.preview.vars]
HORIZON_URL = "https://horizon-testnet.stellar.org"
NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"
SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org"
TAK_CONTRACT_ID = "CBI3WR5NQZUQ5PAPV4TBCOFMJ3MOJVZVMH5CKCGVOP63YV2SPFZN3Z7C"
APP_DOMAIN = "takapp.dev"
ADMIN_PUBLIC_KEY = "G-REPLACE-WITH-PREVIEW-ADMIN-PUBLIC-KEY"
[[env.preview.d1_databases]]
binding = "DB"
database_name = "takapp-d1-preview"
database_id = "<preview-database-id>"
migrations_dir = "./drizzle"

[env.production]
name = "takapp-web-production"
[env.production.vars]
HORIZON_URL = "https://horizon.stellar.org"
NETWORK_PASSPHRASE = "Public Global Stellar Network ; September 2015"
SOROBAN_RPC_URL = "https://soroban.stellar.org"
TAK_CONTRACT_ID = "<mainnet-tak-contract-id>"
APP_DOMAIN = "takapp.dev"
ADMIN_PUBLIC_KEY = "G-REPLACE-WITH-PRODUCTION-ADMIN-PUBLIC-KEY"
[[env.production.d1_databases]]
binding = "DB"
database_name = "takapp-d1-production"
database_id = "<production-database-id>"
migrations_dir = "./drizzle"
```

`apps/bot/wrangler.toml`:

```toml
name = "takapp-bot"
main = "src/index.ts"
compatibility_date = "2026-08-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "takapp-d1"
database_id = "00000000-0000-0000-0000-000000000000"

[env.preview]
name = "takapp-bot-preview"
[env.preview.vars]
HORIZON_URL = "https://horizon-testnet.stellar.org"
NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"
SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org"
TAK_CONTRACT_ID = "CBI3WR5NQZUQ5PAPV4TBCOFMJ3MOJVZVMH5CKCGVOP63YV2SPFZN3Z7C"
APP_DOMAIN = "takapp.dev"
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
[[env.preview.d1_databases]]
binding = "DB"
database_name = "takapp-d1-preview"
database_id = "<preview-database-id>"

[env.production]
name = "takapp-bot-production"
[env.production.vars]
HORIZON_URL = "https://horizon.stellar.org"
NETWORK_PASSPHRASE = "Public Global Stellar Network ; September 2015"
SOROBAN_RPC_URL = "https://soroban.stellar.org"
TAK_CONTRACT_ID = "<mainnet-tak-contract-id>"
APP_DOMAIN = "takapp.dev"
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
[[env.production.d1_databases]]
binding = "DB"
database_name = "takapp-d1-production"
database_id = "<production-database-id>"
```

### 3. Set secrets

Secrets are never written to `wrangler.toml`; they are set per environment with
`wrangler secrets put`. Run from each app's directory (`apps/web`, `apps/bot`).

Web worker secrets (per environment):

```bash
wrangler secrets put JWT_SECRET --env preview       # random >= 32 chars
wrangler secrets put FUNDING_SECRET --env preview   # testnet funding secret
wrangler secrets put ADMIN_JWT_SECRET --env preview # random >= 32 chars
wrangler secrets put ADMIN_TOTP_ENC_KEY --env preview # exactly 32 bytes
```

Repeat with `--env production` and production values (the production funding
account secret, distinct random values for the JWT and TOTP secrets).

Bot worker secrets (per environment):

```bash
wrangler secrets put BOT_TOKEN --env preview        # Telegram bot token
wrangler secrets put DEEPSEEK_API_KEY --env preview # DeepSeek API key
```

Repeat with `--env production`.

Optional web-worker vars (set in `[env.<name>.vars]`, not secrets):

- `ADMIN_TOTP_REQUIRED` — set `"false"` to bypass the admin TOTP step-up (dev/staging only).
- `HORIZON_PUBLIC_URL` / `SOROBAN_PUBLIC_RPC_URL` — override the client-facing
  Stellar endpoints. When unset, the client uses the same-origin `/api/stellar/*` proxy.

## Deploy procedure (step by step)

The web worker must be built before it can be deployed; the bot deploys straight
from source. Run the build from the repo root, then deploy each worker from its
own directory.

### Preview

```bash
# 1. Build (web worker -> .open-next; bot is a dry-run typecheck)
pnpm build

# 2. Apply Drizzle migrations to the preview D1 database
pnpm --filter @takapp/web db:generate   # if the schema changed; otherwise skip
npx wrangler d1 migrations apply takapp-d1-preview --env preview --remote

# 3. Deploy the web worker
#    (run from apps/web; there is no root deploy script for the web worker)
wrangler deploy --env preview

# 4. Deploy the bot worker
#    (run from apps/bot)
wrangler deploy --env preview

# 5. Register the Telegram webhook against the deployed bot worker
curl -F "url=https://takapp-bot-preview.<account-subdomain>.workers.dev/" \
     "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook"
```

### Production

```bash
# 1. Build
pnpm build

# 2. Apply Drizzle migrations to the production D1 database
pnpm --filter @takapp/web db:generate   # if the schema changed; otherwise skip
npx wrangler d1 migrations apply takapp-d1-production --env production --remote

# 3. Deploy the web worker (run from apps/web)
wrangler deploy --env production

# 4. Deploy the bot worker (run from apps/bot)
wrangler deploy --env production

# 5. Register the Telegram webhook
curl -F "url=https://takapp-bot-production.<account-subdomain>.workers.dev/" \
     "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook"
```

### Notes

- `pnpm build` runs `opennextjs-cloudflare build` for the web worker and a
  `wrangler deploy --dry-run` typecheck for the bot. Re-run it after any change
  to `apps/web/src/server/**` (the preview worker serves the last build).
- The root `pnpm deploy` script is `pnpm -r deploy`, which currently only matches
  the bot's `wrangler deploy` script. Deploy the web worker with `wrangler deploy`
  directly from `apps/web` (as above), or add a `deploy` script there if you want
  root `pnpm deploy` to cover both.
- The bot's webhook is served at the worker root (`/`); grammY's `cloudflare-mod`
  adapter handles all paths. If you move behind a custom domain or a secret-token
  path, update the `setWebhook` URL accordingly.
- Never put `FUNDING_SECRET`, `JWT_SECRET`, `ADMIN_JWT_SECRET`,
  `ADMIN_TOTP_ENC_KEY`, `BOT_TOKEN`, or `DEEPSEEK_API_KEY` in `wrangler.toml` or
  `[vars]`; they must go through `wrangler secrets put`.

## Verification

After each deploy, confirm the environment is healthy:

1. Web worker: open `https://takapp-web-<env>.<account-subdomain>.workers.dev/`
   and run the signup → funding → SEP-10 login → balance flow.
2. Server reachability: call `/api/trpc/auth.diagnostics` to probe Horizon and D1
   from inside the worker.
3. D1: confirm migrations applied with
   `npx wrangler d1 migrations list takapp-d1-<env> --env <env> --remote`.
4. Bot: send `/ping` in Telegram (should reply `pong`), then `balance`/`shops`/
   `history` for a bound user.

## Rolling back

Workers keep prior deployments available via the Cloudflare dashboard or
`wrangler rollback`. D1 migrations are forward-only (SQLite); to undo a schema
change, generate and apply a corrective migration rather than reverting the file.

```bash
# Roll back a worker to its previous deployment
wrangler rollback --env preview   # or --env production
```

## Environment variable reference

| Variable | Where | Secret? | Purpose |
| --- | --- | --- | --- |
| `HORIZON_URL` | `[vars]` | no | Horizon endpoint the worker forwards to |
| `SOROBAN_RPC_URL` | `[vars]` | no | Soroban RPC endpoint |
| `NETWORK_PASSPHRASE` | `[vars]` | no | Stellar network passphrase |
| `TAK_CONTRACT_ID` | `[vars]` | no | SEP-41 TAK token contract |
| `APP_DOMAIN` | `[vars]` | no | SEP-10 / `stellar.toml` domain |
| `ADMIN_PUBLIC_KEY` | `[vars]` | no | First admin's Stellar public key |
| `DEEPSEEK_BASE_URL` | `[vars]` (bot) | no | DeepSeek API base URL |
| `JWT_SECRET` | secrets | yes | Signs SEP-10 session JWTs |
| `FUNDING_SECRET` | secrets | yes | Funding account secret key |
| `ADMIN_JWT_SECRET` | secrets | yes | Signs admin step-up JWTs |
| `ADMIN_TOTP_ENC_KEY` | secrets | yes | AES-256-GCM key for TOTP secrets at rest |
| `ADMIN_TOTP_REQUIRED` | `[vars]` | no | `"false"` bypasses admin TOTP step-up |
| `BOT_TOKEN` | secrets (bot) | yes | Telegram bot token |
| `DEEPSEEK_API_KEY` | secrets (bot) | yes | DeepSeek API key |
| `HORIZON_PUBLIC_URL` / `SOROBAN_PUBLIC_RPC_URL` | `[vars]` | no | Optional client-facing Stellar endpoints |
