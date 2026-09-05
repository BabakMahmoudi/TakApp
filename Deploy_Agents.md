# Deploying the Agents Worker (`takapp-agents`)

This document describes how to deploy the **TakAppAgent** conversational-agent
worker to Cloudflare. It is a focused companion to `DEPLOYMENT.md` (which covers
the web and bot workers). Read that file first for the shared prerequisites and
environment conventions; this file documents only what is different for the
agents worker.

## What this worker is

The agents worker (`takapp-agents`) hosts the in-app AI assistant on the
**Cloudflare Agents SDK** (`agents`). It runs one Durable Object
(`TakAppAgent`) per conversation, persisting chat history in the DO's own
SQLite memory, and calls DeepSeek (`deepseek-v4-flash`) with a read-only tool
set.

Two properties set it apart from the other workers:

1. **It is not publicly reachable.** It has no public route. The browser talks
   to the web worker's same-origin `/api/agents/[agentId]/chat` route, which
   verifies auth + conversation tenancy and forwards the request to the agents
   worker over a Cloudflare **service binding** (`env.AGENTS.fetch`). Because it
   is binding-only, it can only ever be reached from `takapp-web`.
2. **It owns no D1 migrations.** It binds to the *same* D1 databases as the web
   worker (`takapp-d1`, `takapp-d1-preview`, `takapp-d1-production`) and reads
   business data (shops, menus, users, payments, orders) read-only. The D1
   index table `agent_conversations` is written only by the web worker (via the
   `agents` tRPC router) and by the web proxy route.

## What gets deployed

| Artifact | Worker name | Source | Build output |
| --- | --- | --- | --- |
| Agents worker | `takapp-agents` | `apps/agents/src/index.ts` | deployed from source (no build step) |
| Durable Object `TakAppAgent` | (per-conversation DO) | `apps/agents/src/agents/takapp-agent.ts` | bundled with the worker |
| D1 database (read-only) | `takapp-d1`* | `packages/shared/src/db/schema.ts` | owned/migrated by `apps/web` |

\* The agents worker shares the web worker's D1 databases; it does not create or
migrate them.

## Environments: preview vs production

Wrangler *environments* isolate preview from production, exactly as in
`DEPLOYMENT.md`. The agents worker follows the same convention, one deployment
per environment.

| | `preview` | `production` |
| --- | --- | --- |
| Agents worker | `takapp-agents-preview` | `takapp-agents-production` |
| D1 database (shared) | `takapp-d1-preview` | `takapp-d1-production` |
| Stellar network | Testnet | Public network (mainnet) |
| Web service binding target | `takapp-agents-preview` | `takapp-agents-production` |

The Durable Object binding and its SQLite migration are defined once at the
top level of `wrangler.toml` (not per environment); each deployed worker name
gets its own isolated DO namespace and SQLite data automatically.

## Prerequisites

Everything in `DEPLOYMENT.md` → "Prerequisites", plus:

- A **DeepSeek API key** (for `deepseek-v4-flash`).
- A long random **internal token** string shared between the web and agents
  workers (see "Secrets" below). This is how the agents worker distinguishes
  proxied traffic (arriving over the service binding) from a direct hit.

## One-time setup (per environment)

### 1. No new D1 database

Skip `wrangler d1 create` for the agents worker. It reuses the databases already
created for the web worker. You only need the `database_id`s recorded there:

- preview: the id already in `apps/web/wrangler.toml` under `[env.preview.d1_databases]`
- production: the id in `apps/web/wrangler.toml` under `[env.production.d1_databases]`

Copy those ids into the agents worker's `[env.*.d1_databases]` blocks below.

### 2. Configure `apps/agents/wrangler.toml`

The repo ships the top-level, `preview`, and `production` blocks. Replace the
placeholders and keep the D1 ids in sync with `apps/web/wrangler.toml`:

```toml
name = "takapp-agents"
main = "src/index.ts"
compatibility_date = "2026-08-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "takapp-d1"
database_id = "00000000-0000-0000-0000-000000000000"

[durable_objects]
bindings = [{ name = "TakAppAgent", class_name = "TakAppAgent" }]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["TakAppAgent"]

[vars]
HORIZON_URL = "https://horizon-testnet.stellar.org"
NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"
APP_DOMAIN = "takapp.dev"
SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org"
TAK_CONTRACT_ID = "CBI3WR5NQZUQ5PAPV4TBCOFMJ3MOJVZVMH5CKCGVOP63YV2SPFZN3Z7C"
DEEPSEEK_BASE_URL = "https://api.deepseek.com"

[env.preview]
name = "takapp-agents-preview"
[env.preview.durable_objects]
bindings = [{ name = "TakAppAgent", class_name = "TakAppAgent" }]
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
name = "takapp-agents-production"
[env.production.durable_objects]
bindings = [{ name = "TakAppAgent", class_name = "TakAppAgent" }]
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

Notes:

- **Durable Object bindings are not inherited by Wrangler environments**, so
  `[durable_objects]` must be repeated in every `[env.*]` block (see
  `[env.preview.durable_objects]` / `[env.production.durable_objects]` above).
  The top-level `[[migrations]]` entry IS inherited (an environment-level
  migrations block would override it), so it does not need to be repeated.
- The `D1` binding here is **read-only at runtime**; the agents worker never
  writes to D1. It must point at the *same* database the web worker uses.
- Keep the Stellar/Soroban/TAK vars identical to the web worker for the same
  environment, or balance/history answers will be wrong.

### 3. Web worker service binding

The web worker forwards chat requests over a service binding named `AGENTS`.
This is already present in `apps/web/wrangler.toml` for the top level and
`preview`. Add the production entry so the web worker can reach the production
agents worker:

```toml
[[services]]
binding = "AGENTS"
service = "takapp-agents"

# ... existing [env.preview] block ...

[[env.preview.services]]
binding = "AGENTS"
service = "takapp-agents-preview"

[[env.production.services]]
binding = "AGENTS"
service = "takapp-agents-production"
```

The binding name (`AGENTS`) must match `WorkerEnv.AGENTS` in
`apps/web/src/server/trpc/env.ts`.

### 4. Set secrets

Secrets are set per environment with `wrangler secrets put`, run from
`apps/agents`.

```bash
# DeepSeek API key for the chat model
wrangler secrets put DEEPSEEK_API_KEY --env preview
wrangler secrets put DEEPSEEK_API_KEY --env production

# Internal token shared with the web worker
wrangler secrets put AGENTS_INTERNAL_TOKEN --env preview
wrangler secrets put AGENTS_INTERNAL_TOKEN --env production
```

**`AGENTS_INTERNAL_TOKEN` must match the value set on the web worker for the
same environment.** Set the same secret on the web worker:

```bash
# run from apps/web
wrangler secrets put AGENTS_INTERNAL_TOKEN --env preview
wrangler secrets put AGENTS_INTERNAL_TOKEN --env production
```

If the two values differ, the agents worker rejects every proxied request with
`403 Forbidden`. If the agents worker has no token set at all, the check is
skipped (this is intentional for local dev only — always set it in
preview/production).

## Deploy procedure (step by step)

**Deploy order matters.** The agents worker must be deployed *before* the web
worker in each environment, otherwise `env.AGENTS` can briefly resolve to a
missing worker. Deploying the agents worker first is backward compatible: it
adds a new worker and changes nothing in existing flows.

### Preview

```bash
# 1. Typecheck/bundle-check the agents worker (deploys from source; no build step)
pnpm --filter @takapp/agents build    # = wrangler deploy --dry-run

# 2. Deploy the agents worker (run from apps/agents)
wrangler deploy --env preview

# 3. Deploy the web worker (run from apps/web) so the binding + proxy route go live
pnpm --filter @takapp/web build
wrangler deploy --env preview
```

### Production

```bash
# 1. Bundle-check
pnpm --filter @takapp/agents build

# 2. Deploy the agents worker (run from apps/agents)
wrangler deploy --env production

# 3. Deploy the web worker (run from apps/web)
pnpm --filter @takapp/web build
wrangler deploy --env production
```

The `agents` worker's `deploy` script is just `wrangler deploy`, so `pnpm -r
deploy` from the root would also match it — but always deploy the agents worker
before the web worker, so prefer the explicit per-worker commands above.

## Verification

There is no public URL for the agents worker; verify it through the web worker
(the same way users reach it):

1. **Health/route smoke test** (binding-only, so test via the web worker): open
   `https://takapp-web-preview.<account>.workers.dev/agents`, start a
   conversation, and confirm tokens stream and the conversation list persists
   across reloads.
2. **Anonymous chat**: in a logged-out browser (or private window) send a general
   question; it should answer. A personalized question ("what's my balance?")
   should politely ask you to log in.
3. **Authed chat**: log in, ask "what's my balance?" and "show my order
   history"; confirm real data comes back.
4. **Tenancy**: with two accounts, open one conversation's `memoryId` from the
   other account and confirm the proxy returns `403`.
5. **Worker-level check**: `wrangler tail takapp-agents --env preview` (run from
   `apps/agents`) and look for `[agent] chat error` / `[agent] tool error`
   lines if anything fails. Raw DeepSeek errors are logged but never streamed to
   the client.
6. **Bindings check**: `wrangler deploy --dry-run` prints the resolved bindings;
   confirm `TakAppAgent` (Durable Object), `DB` (D1), and the `[vars]` appear
   for the target environment.

## Rolling back

```bash
# run from apps/agents
wrangler rollback --env preview     # or --env production
```

The Durable Object SQLite migration (`new_sqlite_classes`) is forward-only and
managed by the worker deployment. Rolling back a worker does not destroy
conversation history; a rolled-back DO build simply reads the existing DO data.
D1 changes (the `agent_conversations` index) are owned by the web worker and
rolled back there if needed.

## Local development

```bash
# 1. Copy and fill in the secrets
#    apps/agents/.dev.vars.example -> apps/agents/.dev.vars
#    DEEPSEEK_API_KEY, AGENTS_INTERNAL_TOKEN

# 2. Run the agents worker locally
pnpm --filter @takapp/agents dev     # wrangler dev (serves the DO locally)

# 3. In the web worker, the AGENTS service binding resolves to the local
#    agents worker automatically when both run under `wrangler dev` (see the
#    Cloudflare local service-binding docs if it does not).
```

In local dev the agents worker does not require `AGENTS_INTERNAL_TOKEN` to be
set — `isInternalRequest` skips the check when the secret is absent. If you set
it locally, set the same value in both `apps/agents/.dev.vars` and
`apps/web/.dev.vars`.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `403 Forbidden` on every chat | `AGENTS_INTERNAL_TOKEN` differs between web and agents workers | Set the same secret on both, then redeploy |
| Chat streams but no data tools work | Agents worker D1 binding points at a different database than the web worker | Point `DB` at the same `database_id` as `apps/web/wrangler.toml` |
| Model errors (`[agent] chat error`) | `DEEPSEEK_API_KEY` missing, or the model name is wrong | Set the secret; confirm `deepseek-v4-flash` in `apps/agents/src/llm/deepseek.ts` is a valid DeepSeek model name |
| Old conversation opens empty | DO was evicted and its SQLite memory reset (acceptable for v1); the D1 index row remains | Start a new conversation; no recovery available |
| `crypto-market` agent returns `501` | The catalog stub has no DO binding yet (deferred) | Expected; only `takapp-agent` is routable in v1 |
| Deploy fails: `Durable Objects ... not exported` | The DO class must be exported from the entrypoint | `apps/agents/src/index.ts` re-exports `TakAppAgent`; do not remove it |

## Environment variable reference (agents worker)

| Variable | Where | Secret? | Purpose |
| --- | --- | --- | --- |
| `HORIZON_URL` | `[vars]` | no | Horizon endpoint for XLM balance reads |
| `SOROBAN_RPC_URL` | `[vars]` | no | Soroban RPC for TAK balance reads |
| `NETWORK_PASSPHRASE` | `[vars]` | no | Stellar network passphrase |
| `TAK_CONTRACT_ID` | `[vars]` | no | SEP-41 TAK token contract |
| `APP_DOMAIN` | `[vars]` | no | Branding/app domain |
| `DEEPSEEK_BASE_URL` | `[vars]` | no | DeepSeek API base URL |
| `DEEPSEEK_API_KEY` | secrets | yes | DeepSeek API key |
| `AGENTS_INTERNAL_TOKEN` | secrets | yes | Shared secret verifying service-binding traffic (must match the web worker) |

Never put `DEEPSEEK_API_KEY` or `AGENTS_INTERNAL_TOKEN` in `wrangler.toml` or
`[vars]`; they must go through `wrangler secrets put`.
