# Fix TAK send: "expected a 'Transaction', got: [object Object]"

## Goal

Sending TAK to a valid wallet currently fails in the browser with:

```
expected a 'Transaction', got: [object Object]
```

Make the TAK transfer (Soroban `transfer` invoke via simulate + assemble) succeed end to end.

## Root cause (confirmed)

The error is thrown by `@stellar/stellar-base`'s `TransactionBuilder.cloneFrom`, reached through `assembleTransaction` (`node_modules/@stellar/stellar-sdk/lib/rpc/transaction.js:46`):

```js
if (!(tx instanceof _transaction.Transaction)) {
  throw new TypeError("expected a 'Transaction', got: ".concat(tx));
}
```

The worker builds the transaction with a **different copy** of stellar-base than the one `assembleTransaction` checks against, so `instanceof Transaction` fails even though the object is a real `Transaction`.

Two module copies exist because the worker mixes two SDK entry points that resolve differently in a **browser** bundle:

| Import | Browser resolution | stellar-base copy |
| --- | --- | --- |
| `@stellar/stellar-sdk` (main) | `dist/stellar-sdk.min.js` (webpack bundle with stellar-base **inlined**) | copy A |
| `@stellar/stellar-sdk/rpc` | `lib/rpc/index.js` → `require("@stellar/stellar-base")` | copy B (standalone `@stellar/stellar-base`) |

`stellar-worker.ts` imports `TransactionBuilder`, `Address`, `Contract`, `Keypair`, `nativeToScVal` from `@stellar/stellar-sdk` (copy A) but `assembleTransaction` from `@stellar/stellar-sdk/rpc` (copy B). So `TransactionBuilder.build()` returns a copy-A `Transaction`, and `assembleTransaction`'s `cloneFrom` rejects it.

All the base types the worker uses are actually **`@stellar/stellar-base` exports** (`Contract`, `Address`, `Keypair`, `nativeToScVal`, `TransactionBuilder` — confirmed in `node_modules/@stellar/stellar-base/lib/*`), so they can be imported from the single standalone `@stellar/stellar-base` package (copy B), matching what `/rpc` already uses internally.

The bug is browser-only: under Node/Vitest both paths resolve to the same `lib` copy, so it does not reproduce in tests.

## Changes

### 1. `apps/web/package.json`

Add the standalone base package as a direct dependency (alphabetical position, after `@scure/bip39`):

```jsonc
"@stellar/stellar-base": "^15.0.0",
```

(`@stellar/stellar-sdk@^15.0.0` already depends on `@stellar/stellar-base@^15.0.0`; this makes the import legal under pnpm strict `node_modules` and dedupes to the installed `15.0.0`.)

### 2. `apps/web/src/workers/stellar-worker.ts` (imports only)

Replace the two import statements (lines 4-12):

```ts
import {
  Address,
  Contract,
  Horizon,
  Keypair,
  nativeToScVal,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { Api as SorobanApi, Server as SorobanRpc, assembleTransaction } from '@stellar/stellar-sdk/rpc';
```

with:

```ts
import { Address, Contract, Keypair, nativeToScVal, TransactionBuilder } from '@stellar/stellar-base';
import { Horizon } from '@stellar/stellar-sdk';
import { Api as SorobanApi, Server as SorobanRpc, assembleTransaction } from '@stellar/stellar-sdk/rpc';
```

No other code changes: the `submit-payment` handler, `sign-challenge`, `generate-keypair`, and `derive-from-mnemonic` bodies stay the same.

### 3. Update lockfile

Run `pnpm install` from the repo root so `pnpm-lock.yaml` records `@stellar/stellar-base` under the `@takapp/web` importer.

## Why this is sufficient

- `TransactionBuilder` now comes from the same standalone `@stellar/stellar-base` (copy B) that `assembleTransaction`/`cloneFrom` uses, so `instanceof Transaction` passes.
- `Contract`, `Address`, `Keypair`, `nativeToScVal` moved to the same copy so the invoke-host-function `Operation`, its `func`, and the `ScVal` args are all built and serialized by one stellar-base instance (no cross-copy xdr serialization).
- `Horizon` stays on `@stellar/stellar-sdk` (copy A). It is only used for `server.loadAccount(...)`; the returned `Account` is consumed duck-typed by `TransactionBuilder` (`source.sequenceNumber()`, `source.accountId()`, `source.incrementSequenceNumber()` — no `instanceof` checks in `TransactionBuilder.build()`), so the copy mismatch is harmless there. It also already works today (the failure happens later, at `assembleTransaction`).
- `sign-challenge` (SEP-10) and the key-derivation paths move to copy B too; they are fully functional and more consistent (no `instanceof`-sensitive code involved).

## Risks

- **Type friction**: `Contract`/`Address`/`nativeToScVal`/`TransactionBuilder`/`Keypair` are all `@stellar/stellar-base` exports with the same shapes the worker already uses. `pnpm typecheck` will catch any residual mismatch.
- **Bundle**: `@stellar/stellar-base` is already pulled into the worker bundle today via `/rpc`'s `require("@stellar/stellar-base")`, so this adds no meaningful new weight; it just makes the worker use that existing copy instead of the duplicate inlined in `stellar-sdk.min.js`.
- The bug is bundling-specific and will not reproduce under Vitest (Node resolution dedupes to one copy), so no unit test can exercise the exact dual-copy path.

## Validation

1. `pnpm install` (repo root) — updates lockfile.
2. `pnpm typecheck` — all workspaces.
3. `pnpm lint`.
4. `pnpm build` — confirms the worker/client bundle compiles with the new import graph.
5. Manual smoke test in the browser: `pnpm dev`, log in, open **Send**, select a valid recipient, enter an amount, send TAK. Expect no `expected a 'Transaction'` error; the transaction simulates, assembles, signs, submits, and records the payment.
6. Confirm the send succeeds on testnet (recipient balance increases / payment appears in history).

## Out of scope

- Server-side (`src/server/**`) and bot (`apps/bot/**`) stellar imports already use `no-axios` per the prior fix (`1788121645766-stellar-horizon-no-axios-fix.md`) and are unaffected.
- Replacing `Horizon.Server.loadAccount` in the worker with a raw fetch + `Account` (would remove the last `@stellar/stellar-sdk` main-entry import and axios from the worker bundle) — optional follow-up, not required for this fix.
- An automated regression test that reproduces the browser dual-copy `instanceof` failure is not practical under Vitest; manual browser validation is the authoritative check here.
