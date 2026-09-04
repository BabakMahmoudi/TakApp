# Stellar Network Proxy Support

## Problem

Users (and the developer) in regions where direct connections to Stellar endpoints are filtered or throttled see slow/failing Horizon and Soroban RPC traffic. A VPN fixes it locally, but we cannot require every user to run a VPN.

**Root cause (verified against the code):** only the **client-side payment flow** talks to Stellar directly from the browser. Everything else already egresses from the Cloudflare edge, outside the user's network.

| Path | Where it runs | Affected by region filtering? |
| --- | --- | --- |
| `wallet.balance` (Horizon `loadAccount` + Soroban `getContractData`) | Cloudflare worker (edge) | No |
| `auth.signup` funding, `auth.diagnostics` probes | Cloudflare worker (edge) | No |
| Telegram bot balance reads | Cloudflare worker (edge) | No |
| `stellar-worker.ts` payment: `loadAccount`, `simulateTransaction`, `submitTransaction` (`stellar-worker.ts:88-136`) | Browser Web Worker | **Yes** |
| Local `pnpm dev`: all worker `fetch` calls egress from the dev machine | Local workerd | **Yes** |

The three browser calls get their base URLs from `wallet.networkConfig` (`wallet.ts:21-28`), which currently returns the raw `HORIZON_URL`/`SOROBAN_RPC_URL`, and the worker consumes them generically (`wallet-provider.tsx:190-191` → `stellar-worker.ts:88,90,114`).

## Solution

Three parts, as agreed with the user ("Both" + local-dev proxy):

1. **Production: same-origin reverse proxy on the existing Cloudflare worker.** A route handler forwards `/api/stellar/horizon/*` and `/api/stellar/soroban/*` to the real endpoints from the edge. Since the app's own origin is already reachable, this sidesteps endpoint blocking without any per-user setup.
2. **Client endpoint override via env.** `wallet.networkConfig` returns client-facing URLs: env override when set, otherwise the same-origin proxy. No worker/UI changes needed.
3. **Local dev: standalone Node forward-proxy script** so `pnpm dev` can tunnel Stellar traffic through the developer's forward proxy (`http://localhost:2352`).

Non-custodial guarantee is preserved: the proxy only relays public reads and **already-signed** XDR (`submitTransaction`); no secret keys ever pass through it.

## Assumption (flag)

The app's own origin must be reachable by end users. If Cloudflare itself is filtered in a region, this proxy does not help and those users still need a VPN. This is a known limitation, not addressed here.

## Changes

### 1. Env surface — `apps/web/src/server/trpc/env.ts`

Add two optional client-facing fields:

```ts
HORIZON_PUBLIC_URL?: string;   // client-facing Horizon base; default: same-origin /api/stellar/horizon
SOROBAN_PUBLIC_RPC_URL?: string; // client-facing Soroban RPC base; default: same-origin /api/stellar/soroban
```

`HORIZON_URL` and `SOROBAN_RPC_URL` remain the **server-side** upstreams (unchanged).

### 2. Reverse-proxy route handler — `apps/web/src/app/api/stellar/[...path]/route.ts`

New Next.js App Router route handler (mirrors the tRPC route's `getCloudflareContext()` pattern from `api/trpc/[trpc]/route.ts`).

Spec:
- `path` segments: first must be `horizon` or `soroban`; otherwise `404`.
- Reject traversal/absolute segments: any segment `== ''`, `== '.'`, `== '..'`, or containing `..` or `/` → `400`.
- Upstream base = `env.HORIZON_URL` (for `horizon`) or `env.SOROBAN_RPC_URL` (for `soroban`), trailing slash stripped.
- Upstream URL = `${base}/${segments.slice(1).map(encodeURIComponent).join('/')}` + incoming query string (`new URL(req.url).search`). Note: Next 15 route `params` is a `Promise<{ path: string[] }>` — `await` it; segments arrive URL-decoded, so re-encode each.
- Forward method, `content-type`, `accept`; buffer the request body (`await req.text()` for POST) and send it upstream. Apply `AbortSignal.timeout(30_000)`.
- Return `new Response(body, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' } })`. Do **not** copy `Set-Cookie`, `content-length`, `content-encoding`, or `access-control-*` (workerd `fetch` already decompresses and strips encoding/length).
- Wrap the upstream `fetch` in `logHttp` from `src/server/logging.ts`; on thrown error return `502` with a short JSON body and log via `serializeError`.
- Export `GET` and `POST` (Horizon reads are GET; Soroban RPC and Horizon `/transactions` are POST). Same-origin requests need no CORS/OPTIONS handling.
- No auth required (public reads + signed tx submission).

### 3. Client-facing resolution — `apps/web/src/server/trpc/routers/wallet.ts`

Change `networkConfig` only:

```ts
networkConfig: publicProcedure.query(async ({ ctx }) => {
  const origin = new URL(ctx.req.url).origin;
  return {
    horizonUrl: ctx.env.HORIZON_PUBLIC_URL ?? `${origin}/api/stellar/horizon`,
    networkPassphrase: ctx.env.NETWORK_PASSPHRASE,
    sorobanRpcUrl: ctx.env.SOROBAN_PUBLIC_RPC_URL ?? `${origin}/api/stellar/soroban`,
    takToken: { code: 'TAK', contractId: ctx.env.TAK_CONTRACT_ID, decimals: 7 },
  };
}),
```

The signing worker (`stellar-worker.ts`) and `wallet-provider.tsx` are unchanged — they already pass `config.horizonUrl`/`config.sorobanRpcUrl` through to the SDK and `fetch`.

### 4. `apps/web/wrangler.toml` `[vars]`

Add optional (empty by default) client-facing vars with a comment explaining they override the same-origin proxy:

```toml
# Optional: override the client-facing Stellar endpoints (default: same-origin /api/stellar/horizon|soroban)
# HORIZON_PUBLIC_URL = ""
# SOROBAN_PUBLIC_RPC_URL = ""
```

### 5. Local dev forward proxy — `apps/web/scripts/stellar-dev-proxy.mjs` (new)

A small standalone Node HTTP server (not part of the worker bundle) so `pnpm dev` can reach Stellar through the developer's forward proxy.

Spec:
- Listen on `PORT` (default `8788`, configurable via `STELLAR_DEV_PROXY_PORT`).
- Route by first path segment: `/horizon/*` → `${HORIZON_URL}/*`, `/soroban/*` → `${SOROBAN_RPC_URL}/*` (defaults to testnet if env unset). Preserve method, query, and body.
- If `STELLAR_DEV_FORWARD_PROXY` is set (default `http://localhost:2352`), tunnel outbound HTTPS through it using `undici`'s `ProxyAgent` + `setGlobalDispatcher`; otherwise connect directly.
- Add `undici` as a `devDependency` in `apps/web/package.json` (Node 22 does not expose `node:undici`; `ProxyAgent`/`setGlobalDispatcher` are the supported path).

Dev usage (documented in `.dev.vars.example` and README):
- `.dev.vars`: `HORIZON_URL=http://localhost:8788/horizon` and `SOROBAN_RPC_URL=http://localhost:8788/soroban`.
- Run `node scripts/stellar-dev-proxy.mjs` (via a new `dev:proxy` script) alongside `pnpm dev`.
- This also exercises the production reverse-proxy route end-to-end in dev (browser → local worker route `/api/stellar/*` → `HORIZON_URL` = local proxy → forward proxy → Stellar).

### 6. `apps/web/package.json` + `.dev.vars.example` + `README.md`

- Add `"dev:proxy": "node scripts/stellar-dev-proxy.mjs"` script.
- `.dev.vars.example`: document the local-proxy `HORIZON_URL`/`SOROBAN_RPC_URL` values and `STELLAR_DEV_FORWARD_PROXY`/`STELLAR_DEV_PROXY_PORT`, plus the optional `HORIZON_PUBLIC_URL`/`SOROBAN_PUBLIC_RPC_URL`.
- `README.md`: add the two optional env vars and a short "Network proxy / filtered regions" note (production same-origin proxy is automatic; local dev uses `dev:proxy`).

### 7. Tests (Vitest)

- `apps/web/test/stellar-proxy.test.ts` (new): drive the route handler directly with `vi.stubGlobal('fetch', mock)` and assert:
  - horizon path maps to `${HORIZON_URL}/accounts/G...` (GET), soroban path maps to `${SOROBAN_RPC_URL}` base POST;
  - POST body + `content-type` forwarded;
  - upstream status + content-type passed through;
  - unknown first segment → 404; `..`/empty segment → 400;
  - upstream fetch rejection → 502.
- `apps/web/test/network-config.test.ts` (new) or extend existing router test: using `buildCaller` from `test/helpers/caller.ts`, assert `networkConfig` returns `${origin}/api/stellar/horizon` and `/api/stellar/soroban` when no override, and the override values when `HORIZON_PUBLIC_URL`/`SOROBAN_PUBLIC_RPC_URL` are set.
- Update `testEnv` in `apps/web/test/helpers/caller.ts` to include the new optional fields (or leave undefined; optional fields need no change).

### 8. Docs — `ARCHITECTURE.md`

Update the System Components diagram note and Deployment/`Env` list to mention: client Stellar traffic is proxied same-origin through `/api/stellar/*`; `HORIZON_PUBLIC_URL`/`SOROBAN_PUBLIC_RPC_URL` override it; local dev uses the `dev:proxy` forward script.

## Validation

1. `pnpm typecheck` and `pnpm lint`.
2. `pnpm test` (new proxy + network-config tests green; existing funding/balance/sep10 tests unchanged).
3. `pnpm build` then `pnpm dev` with the `dev:proxy` script running and VPN off: sign up, login, and complete a TAK payment; confirm `[http]` logs show the proxied path and no Horizon/RPC timeouts.
4. Deployed smoke test (or `wrangler dev`): confirm `wallet.networkConfig` returns the same-origin proxy URLs and the payment flow works for a filtered-network client.

## Open questions / risks

- **OpenNext route-handler support** for catch-all `[...path]` with POST bodies on Cloudflare: verify during implementation; buffering bodies (no streaming) is the safe path. Streaming (Horizon SSE) is out of scope — not used.
- **Service worker**: confirm Serwist `defaultCache` (`sw.ts`) does not cache `/api/stellar/*` GETs (POSTs are never cached by the SW).
- **Abuse**: the proxy is an open relay to public endpoints; low risk (public data + signed XDR only). Rate limiting / keying is future hardening, not in scope.
- **Cloudflare blocked region**: if the app origin itself is filtered, the proxy cannot help (documented limitation).
- **`undici` availability**: confirm `ProxyAgent`/`setGlobalDispatcher` exports resolve in Node 22; pin `undici` as a devDependency.
