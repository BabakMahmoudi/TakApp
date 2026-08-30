# Fix `auth.signup` 500 `internal error; reference = …` — pinpoint logging + hardening

## Context

- Symptom: after saving the 12-word mnemonic, clicking "continue" fails. `POST /api/trpc/auth.signup` → 500 after **~46s**.
- Console shows only a workerd runtime error (no JS stack):
  ```
  [Error: internal error; reference = c79pm0hsvmqcl6fjdn2451u1] { remote: true, overloaded: true }
  [wrangler:info] POST /api/trpc/auth.signup 500 Internal Server Error (46335ms)
  ```
- `internal error; reference = <id>` is **not a JS error from our code**; it is a workerd/miniflare runtime error. Two known upstream bugs produce this exact string in local dev:
  - **workers-sdk #9356** (OPEN): outbound **HTTPS `fetch()` subrequests** fail in `wrangler preview` (stack: `middleware-ensure-req-body-drained` / `middleware-miniflare3-json-error`); works when URL is `http`.
  - **workers-sdk #10506** (fixed by PR #11771): **D1** errors in local/test contexts (`cloudflare-internal:d1-api`).
- `auth.signup` steps, in order: ① D1 `SELECT` existing user → ② PBKDF2 hash (WebCrypto, 600k iter) → ③ Horizon HTTPS `loadAccount` → ④ Horizon HTTPS `submitTransaction` → ⑤ D1 `INSERT` user.
- Previous fix (switch all server SDK imports to `@stellar/stellar-sdk/no-axios` — already in working tree) did **not** help → the SDK HTTP client is not the root cause; the failure is at the workerd fetch/D1 layer.
- Environment: `wrangler 4.127.1` + **`miniflare 5.20260828.0-alpha`** (alpha!) + `workerd 1.20260828.1`; `@opennextjs/cloudflare 1.20.4`; dev = `opennextjs-cloudflare preview`; local D1 exists at `apps/web/.wrangler/state/v3/d1/` (was touched on the failed runs).
- `apps/web/node_modules/.mf/cf.json` shows the dev machine is on a network in **Tehran, Iran** → `https://horizon-testnet.stellar.org` may be blocked/slow from this network, which fits the ~46s hang.
- The pasted log shows **no** `[funding] loadAccount` / `[funding] submitTransaction` / `[funding] failed` / `[trpc]` lines, but the user is unsure the paste was the complete output → the next run must unambiguously mark every step.

## Goal

One dev run of signup must print a marker for **every** step and a Horizon + D1 reachability probe result, so the last marker before failure identifies the culprit step deterministically. Then apply the matching hardening.

## Part 1 — Instrumentation (implement first)

### 1.1 New `apps/web/src/server/logging.ts`
- `serializeError(err: unknown): string` — returns `name: message`, full `cause` chain, `stack`, and **all enumerable own properties** (so `remote`, `overloaded`, the reference id survive). Wrap in try/catch; never throw on circular structures.
- `logStep(label: string, fn: () => Promise<T>): Promise<T>` — logs `[signup] <label> start`, `[signup] <label> ok (Xms)`, or `[signup] <label> FAILED after Xms: <serializeError>`; rethrows.
- `logHttp(method: string, url: string, fn: () => Promise<Response>): Promise<Response>` — logs method, URL, start, duration, `status` on success; on error logs `serializeError(e)`; rethrows.
- `d1Probe(db): Promise<{ok: boolean; durationMs: number}>` — runs `SELECT 1`; module-level flag so it runs once per isolate; logs result.
- `reqId()` — short random id included in every log line so a single request's lines can be grouped in the interleaved preview console.

### 1.2 Step markers — `apps/web/src/server/trpc/routers/auth.ts`
Wrap each phase of `signup` in `logStep`:
- `existing-user-check` (log SQL via `builder.toSQL()`; never log parameters with secrets — publicKey/email are fine)
- `hash-password`
- `fund-new-account`
- `insert-user`
At mutation start log: `[signup] mutation start reqId=<id> pubkey=<first 6 chars> hasEmail=<bool>`. **Never log the password, mnemonic, or seed.**
Add `diagnostics: publicProcedure.query` that returns/logs:
- Horizon probe: `fetch(HORIZON_URL + '/', { signal: AbortSignal.timeout(10_000) })` → `{ horizonReachable, status, durationMs, error }`.
- D1 probe: `SELECT 1` → `{ d1Ok, durationMs, error }`.
Not linked in the UI; callable via `/api/trpc/auth.diagnostics` and invoked (logged) automatically on the first signup attempt.

### 1.3 Horizon request-level logging — `apps/web/src/server/stellar/funding.ts`
- Log `[funding] funding-account=<pubkey>`, `[funding] loadAccount start`, `[funding] loadAccount ok (Xms)` / `[funding] loadAccount FAILED …` (distinguish NotFound = account missing vs network error).
- Add request-level logging to the SDK httpClient via `interceptors.request`/`interceptors.response` (available on the `no-axios` fetch client) OR wrap `server.httpClient.get/post` directly: method, URL, start, duration, HTTP status, serialized error. Mark the Horizon base URL host.
- Keep `server.httpClient.defaults.timeout = 15_000` and `maxRedirects = 10` (they engage the bounded fetch adapter).

### 1.4 tRPC error surfacing
- `apps/web/src/app/api/trpc/[trpc]/route.ts`: replace the current `onError` with one that logs `[trpc] <code> <path> (Xms): <serializeError(error)>` plus the request duration. This captures the workerd error verbatim **with a `[trpc]` prefix and the path** when the error does flow through tRPC (it is expected the runtime-kill path may bypass this — that absence is itself a diagnostic).
- `apps/web/src/server/trpc/trpc.ts`: add a `.use()` logging middleware attached to `publicProcedure`/`protectedProcedure` — `[trpc] start <path>`, `[trpc] ok <path> (Xms)`, `[trpc] error <path> (Xms): <serializeError>`.
- `apps/web/src/server/trpc/context.ts`: attach `reqId` to `TrpcContext` so all log lines share it.

## Part 2 — Hardening (apply per the diagnostics outcome)

### 2.1 First, prove connectivity from the host (cheap, decisive)
- From the machine: `curl.exe -I https://horizon-testnet.stellar.org` and `Test-NetConnection horizon-testnet.stellar.org -Port 443`. Record result in the log notes.
- Re-run the probe **with `http://`** if possible (issue #9356: https subrequests fail, http works) to distinguish "wrangler HTTPS-fetch bug" from "network block".

### 2.2 Scenario A — Horizon unreachable/slow (expected)
- **Environmental (likely primary fix):** the Tehran network cannot reach Stellar testnet reliably. Use a reachable network/VPN for dev, or an alternate Horizon endpoint reachable from the region. Document in `README.md`/`AGENTS.md`.
- **Code hardening:**
  - Replace the SDK `submitTransaction` call (hardcoded `SUBMIT_TRANSACTION_TIMEOUT = 60s`) with a direct `fetch` POST to `<HORIZON_URL>/transactions` (`tx=<base64 xdr>` form-encoded) under `AbortSignal.timeout(20_000)`, wrapped in `logHttp`. Parse `result_xdr` via `xdr.TransactionResult.fromXDR(...)`, throw with the Horizon error body on failure. LoadAccount stays on the SDK (15s timeout already).
  - This turns a ~46s silent runtime kill into a fast, visible failure (≤20s) with a JS error the `[trpc]` logger captures.

### 2.3 Scenario B — D1 failing
- Run `pnpm db:migrate`; confirm `users` table exists in local D1.
- If D1 internal error persists on `miniflare 5.20260828.0-alpha`: pin wrangler to a **stable** 4.x within `@opennextjs/cloudflare`'s peer range (`^4.125.0`) that uses a non-alpha miniflare, and re-test.
- If binding-related: switch `getCloudflareContext()` → `getCloudflareContext({ async: true })` in `route.ts`/`bindings.ts`.

### 2.4 Scenario C — probe ok but signup still fails
- The step markers will have identified the exact step; fix per the marker logs (e.g., PBKDF2 cost, SDK usage).

## Validation

1. `pnpm typecheck`, `pnpm lint`, `pnpm test` (add a `serializeError` unit test in `apps/web/test/`; keep funding tests green).
2. `pnpm db:migrate` (local D1 up to date).
3. `pnpm dev` → run signup flow → observe console: every `[signup]` marker with durations, `[funding]` per-subrequest lines (or a missing marker = earlier failure), and the `diagnostics` probe result.
4. Confirm which step's marker is missing → that is the culprit; apply the matching Part 2 hardening.
5. Re-run signup → expect `[signup] insert-user ok` and phase advances to the trustline step.

## Decisions / out of scope

- Chosen: **"Log first, then harden"** — signup stays a single mutation. The larger "decouple funding into a retryable `auth.fundAccount` procedure" change is a documented follow-up if Horizon proves unreachable long-term.
- No bot worker changes; no production deployment changes in this pass.
- Secrets: the instrumentation must never log `FUNDING_SECRET`, password, mnemonic, or recovered secret keys.
