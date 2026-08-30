# Fix Horizon "internal error" on Cloudflare Workers (switch to `no-axios` SDK)

## Goal

Fix account creation failing on `POST /api/trpc/auth.signup` with a ~47s hang and:

```
[Error: internal error; reference = 6i9c8dm203i1n54vfbjjgle0] { remote: true, overloaded: true }
[wrangler:info] POST /api/trpc/auth.signup 500 Internal Server Error (46804ms)
```

## Root cause (confirmed)

- `@stellar/stellar-sdk` (default entry, v15.1.0) uses **axios** as its HTTP client (`lib/http-client/index.js` hardcodes axios).
- Under `workerd` with `compatibility_flags = ["nodejs_compat"]` (in `apps/web/wrangler.toml`), axios resolves the **Node `http` adapter** (order `['xhr','http','fetch']`), which cannot do outbound networking on Workers. `Horizon` calls hang, `timeout` never fires, and the runtime kills the request with an opaque `internal error` (`remote: true`, `overloaded: true`).
- The SDK ships a fetch-based build at `@stellar/stellar-sdk/no-axios`. Its `fetch-client` honors `timeout` (via `AbortSignal.timeout`) and `maxRedirects` (via `boundedFetchAdapter`). The existing `funding.ts` code already sets `defaults.timeout` and `defaults.maxRedirects` — that code was written for the `no-axios` fetch client, but the import points at the axios build, so it never engaged.
- Verified the `no-axios` types expose `httpClient.defaults` with `timeout?` / `maxRedirects?` (`lib/no-axios/http-client/types.d.ts`), so the existing lines typecheck unchanged.
- Verified the funding account `GD34LHPQRSZKJGTDSTAFHLTJ4AOS77JEAVMXVITLEI2XYCNSH64SIGRM` exists and holds 14316.14 XLM on testnet — funding is not the problem.

## Changes

Switch **all server-side / Worker-runtime** `@stellar/stellar-sdk` imports to `@stellar/stellar-sdk/no-axios`. No behavioral or API changes otherwise.

### 1. `apps/web/src/server/stellar/funding.ts`
- Change import to `@stellar/stellar-sdk/no-axios`.
- Keep `server.httpClient.defaults.timeout = 15_000;` and `.maxRedirects = 10;` (now they engage the bounded fetch adapter).
- Improve logging (see below).

### 2. `apps/web/src/server/stellar/horizon.ts`
- Change `import { Horizon } from '@stellar/stellar-sdk';` → `from '@stellar/stellar-sdk/no-axios';`.

### 3. `apps/web/src/server/trpc/routers/wallet.ts`
- Change `import { Horizon } from '@stellar/stellar-sdk';` → `from '@stellar/stellar-sdk/no-axios';`.

### 4. `apps/web/src/server/stellar/sep10.ts`
- Change `import { Keypair, WebAuth } from '@stellar/stellar-sdk';` → `from '@stellar/stellar-sdk/no-axios';` (both are re-exported; keeps axios out of the server bundle entirely).

### 5. `apps/bot/src/stellar.ts`
- Change `import { Horizon } from '@stellar/stellar-sdk';` → `from '@stellar/stellar-sdk/no-axios';`.
- Same bug affects the bot's read-only `balance` command (it runs on a Worker and calls `Horizon.Server.loadAccount`).

## Logging improvement (`funding.ts`)

Add per-step logging and log the raw error object (so `remote`/`overloaded` and the underlying cause survive instead of being flattened to a string). Recommended shape:

```ts
export async function submitCreateAccount(
  server: FundingServer,
  params: Omit<FundNewAccountParams, 'horizonUrl'>,
): Promise<unknown> {
  const funding = Keypair.fromSecret(params.fundingSecret);
  console.log(`[funding] loadAccount funding=${funding.publicKey()}`);
  const fundingAccount = await server.loadAccount(funding.publicKey());
  const tx = new TransactionBuilder(fundingAccount, {
    fee: '100',
    networkPassphrase: params.networkPassphrase,
  })
    .addOperation(Operation.createAccount({ destination: params.destination, startingBalance: '1.5' }))
    .setTimeout(30)
    .build();
  tx.sign(funding);
  console.log(`[funding] submitTransaction destination=${params.destination}`);
  return server.submitTransaction(tx);
}

export async function fundNewAccount(params: FundNewAccountParams): Promise<unknown> {
  const server = new Horizon.Server(params.horizonUrl);
  server.httpClient.defaults.timeout = 15_000;
  server.httpClient.defaults.maxRedirects = 10;
  const started = Date.now();
  try {
    return await submitCreateAccount(server, params);
  } catch (error) {
    console.error(`[funding] failed after ${Date.now() - started}ms`, error);
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Account funding failed: ${detail}`);
  }
}
```

The tRPC `onError` in `apps/web/src/app/api/trpc/[trpc]/route.ts` already logs `error.cause`; no change needed there.

## Out of scope / unchanged

- `apps/web/src/workers/stellar-worker.ts` — runs in the browser Web Worker, not the Workers runtime; the default SDK (xhr/fetch adapter) works there. Leave as-is.
- `apps/web/test/*.test.ts`, `packages/shared/test/*` — run under Node/Vitest and use fake servers; the default SDK is fine there.
- `scripts/derive-keypair.mjs` — local Node utility, not a Worker.

## Risks

- **Type friction**: `Horizon.Server` / `httpClient` types come from `no-axios` now. Confirmed `defaults.timeout` / `defaults.maxRedirects` exist in `no-axios` types. `pnpm typecheck` will catch any residual mismatch.
- **Submit timeout**: `no-axios`'s `submitTransaction` still sets its own `SUBMIT_TRANSACTION_TIMEOUT = 60s` (see `lib/no-axios/horizon/server.js`). Worst case a stuck submit now fails at 60s instead of hanging indefinitely. Optional follow-up: pass an explicit shorter `timeout` to `submitTransaction` — not required for this fix.

## Validation

1. `pnpm typecheck` (all workspaces).
2. `pnpm lint`.
3. `pnpm test` (funding/sep10/zod tests must stay green; funding.test.ts uses a fake server and is unaffected).
4. Manual smoke: `pnpm dev`, run the signup flow (create wallet → save mnemonic → continue). Expect the account to fund and move to the trustline step **quickly (<15s)**, with no `internal error`.
5. Confirm via logs: `[funding] loadAccount …` and `[funding] submitTransaction …` lines appear; run `wrangler tail` (from `apps/web`) and confirm the Horizon subrequests succeed.
6. Confirm the funding account was debited and the new account exists on testnet via Horizon (optional): `https://horizon-testnet.stellar.org/accounts/<newPublicKey>`.
