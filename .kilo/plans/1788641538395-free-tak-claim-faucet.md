# Claim 3 Free TAK (one-time faucet)

## Goal

Replace the informational "Testnet faucet" text on the **Get TAK** page (`/tak`) with a **"Claim 3 free TAK"** button. Clicking it transfers **3 TAK** to the user's Stellar account, server-signed. Each user may claim **exactly once**.

## Decisions

| Decision | Choice |
| --- | --- |
| Funding source | **Reuse `GAME_ACCOUNT_SECRET`** (the casino/house account) — no new secret. `FUNDING_SECRET` is ruled out (it can never move TAK). |
| Amount | `3 TAK = 30000000` stroops (7 decimals). Constant `CLAIM_AMOUNT_STROOPS`. |
| Claim-once enforcement | Composite **unique index on `gifts(user_id, type)`** + insert-first reservation (see flow). |
| Transfer path | Reuse existing `submitTakTransfer` (`apps/web/src/server/stellar/tak-transfer.ts`). |
| Record | Use the existing `gifts` table (`type='tak-claim-3'`, `amount='30000000'`). No `payments` row (not a payment; keeps the bot history clean). |
| API | New tRPC `tak` router: `status` (query) + `claim` (mutation). |

## Context

- The faucet text is `apps/web/src/app/tak/page.tsx:13-16`, driven by i18n keys `tak.faucetTitle` / `tak.faucetDescription` (`en.ts:80-81`, `fa.ts:82-83`).
- `submitTakTransfer` signs a SEP-41 `transfer` from any server-held secret key; the games feature already uses it with `GAME_ACCOUNT_SECRET` (`apps/web/src/server/games/service.ts:527`).
- `gifts` table exists but is unused (`packages/shared/src/db/schema.ts:159`); it has no unique constraint today.
- Client pattern: pages call `trpc.<router>.<proc>` directly and `useWallet().refetchBalances()` after a balance-changing action (`apps/web/src/lib/wallet-provider.tsx:194-219`).
- Test harness: `apps/web/test/helpers/mock-db.ts` (`MockDb`) + `apps/web/test/helpers/caller.ts` (`buildCaller`, `testEnv`). See `apps/web/test/games.test.ts` for the service-level test pattern (mocks `drizzle-orm`, `fetchTakBalance`, `submitTakTransfer`).

## Changes (ordered)

### 1. Data model — unique index on `gifts`

- `packages/shared/src/db/schema.ts`: import `uniqueIndex` and add a composite unique to the `gifts` table via the table callback:
  ```ts
  export const gifts = sqliteTable('gifts', { /* existing columns */ }, (t) => ({
    userTypeUnique: uniqueIndex('gifts_user_id_type_unique').on(t.userId, t.type),
  }));
  ```
- Run `pnpm db:generate` (produces `apps/web/drizzle/0006_*.sql` with `CREATE UNIQUE INDEX ... ON gifts(user_id, type)`) then `pnpm db:migrate`. `gifts` is empty (unused), so the index applies cleanly.

### 2. Server — claim service

- New `apps/web/src/server/tak/service.ts` (mirrors `games/service.ts` structure):
  - `CLAIM_TYPE = 'tak-claim-3'`, `CLAIM_AMOUNT_STROOPS = '30000000'`.
  - `TakFaucetError extends Error` with codes: `ALREADY_CLAIMED`, `FAUCET_NOT_READY`, `FAUCET_OUT_OF_FUNDS`, `CLAIM_FAILED`; `toTrpcTakError` maps them (NOT_FOUND / BAD_REQUEST / BAD_REQUEST / INTERNAL_SERVER_ERROR) with `message: code` for client i18n mapping.
  - `getClaimStatus(db, userId)` → `{ claimed, claimedAt, amount }` from a `gifts` lookup on `(userId, type=CLAIM_TYPE)`.
  - `claimTak(db, env, { userId, stellarPublicKey })`:
    1. **Pre-check** existing `gifts` row → throw `ALREADY_CLAIMED` (fast path).
    2. Derive faucet keypair from `env.GAME_ACCOUNT_SECRET` → `FAUCET_NOT_READY` if invalid.
    3. Read faucet TAK balance via `fetchTakBalance` (`apps/web/src/server/stellar/horizon.ts`); if `< CLAIM_AMOUNT_STROOPS` → `FAUCET_OUT_OF_FUNDS`.
    4. **Reserve**: `insert(gifts).values({ userId, type: CLAIM_TYPE, amount: CLAIM_AMOUNT_STROOPS, createdAt }).onConflictDoNothing().returning()`; if no row returned → `ALREADY_CLAIMED` (concurrent claim lost).
    5. `submitTakTransfer({ sourceSecret: env.GAME_ACCOUNT_SECRET, destination: stellarPublicKey, amountStroops: CLAIM_AMOUNT_STROOPS, ... })`.
    6. On transfer error: **delete the reservation row** (`where userId + type=CLAIM_TYPE`) so the user can retry, then throw `CLAIM_FAILED`.
    7. Return `{ txHash, amount: CLAIM_AMOUNT_STROOPS }`.
  - Reuse the `fetchTakBalance`/`submitTakTransfer` mocking seams for tests.

### 3. Server — router + wiring

- New `apps/web/src/server/trpc/routers/tak.ts`:
  - `status`: `protectedProcedure.query` → `getClaimStatus`.
  - `claim`: `protectedProcedure.mutation` (no input) → `withTakErrors(() => claimTak(...))`.
- `apps/web/src/server/trpc/router.ts`: add `tak: takRouter` to `appRouter`.
- `apps/web/src/server/trpc/env.ts`: update the `GAME_ACCOUNT_SECRET` comment to note it also signs the one-time 3-TAK claim faucet.

### 4. Client — `/tak` page

- `apps/web/src/app/tak/page.tsx`: replace the static `takMethods` list with a claim card:
  - Use `trpc.tak.status.useQuery()` for the claimed state and `trpc.tak.claim.useMutation()`.
  - Not claimed → **"Claim 3 free TAK"** button (disabled while mutating, `Claiming…` label).
  - On success → `useWallet().refetchBalances()` + invalidate `tak.status`; show claimed confirmation.
  - Claimed → show "You've claimed 3 free TAK".
  - Map mutation error `message` (the typed code) to an i18n key via a small `takClaimErrorKey()` helper (mirror `gameErrorKey` from the games shell), with a generic fallback.
  - Keep the existing logged-out guard (`common.pleaseLogIn` / `common.goToLogin`).

### 5. Client — i18n

- `apps/web/src/lib/i18n/messages/en.ts` and `fa.ts`: **remove** `tak.faucetTitle` / `tak.faucetDescription`; **add**:
  - `tak.claimButton` ("Claim 3 free TAK")
  - `tak.claiming` ("Claiming…")
  - `tak.claimed` ("You've claimed 3 free TAK")
  - `tak.claim.errors.alreadyClaimed`
  - `tak.claim.errors.notReady`
  - `tak.claim.errors.outOfFunds`
  - `tak.claim.errors.claimFailed`
- Both dictionaries must stay key-identical (typed `Messages`).

### 6. Env / docs

- `apps/web/.dev.vars.example`: extend the `GAME_ACCOUNT_SECRET` comment to mention it also funds the one-time 3-TAK claim.
- `ARCHITECTURE.md`:
  - `/tak` bullet (line ~201) → "get TAK: one-time Claim 3 free TAK button (server pays from the casino/faucet account)".
  - `gifts` bullet (line ~130) → describe claim usage (`type='tak-claim-3'`, unique per user, 3 TAK) instead of "retained but unused".
  - Funding-account wording (lines ~74, ~142, ~180) → clarify there are two bounded server-held keys: `FUNDING_SECRET` (XLM funding only) and `GAME_ACCOUNT_SECRET` (casino + claim faucet); the latter signs TAK payouts/claims only.
  - Add a short **"Claim free TAK (one-time)"** flow under **Key Flows**.
- `AGENTS.md`: update the "Funding account (bounded zero-key exception)" bullet (line ~92) to match — `FUNDING_SECRET` never moves TAK; `GAME_ACCOUNT_SECRET` is the bounded TAK-signing key (game prizes, admin withdraws, one-time claim).

### 7. Tests

- New `apps/web/test/tak-claim.test.ts` (model on `games.test.ts`): mock `drizzle-orm` (`eq`/`and`), `fetchTakBalance`, `submitTakTransfer`; seed `gifts`/`users` tables in `MockDb`. Cover:
  - success: reserves → transfers → returns txHash/amount.
  - already claimed (pre-existing row) → `ALREADY_CLAIMED`, no transfer.
  - faucet key invalid → `FAUCET_NOT_READY`.
  - faucet balance < 3 TAK → `FAUCET_OUT_OF_FUNDS`.
  - transfer throws → reservation row deleted + `CLAIM_FAILED`.
- Note: `MockDb.unique` only models single-column uniqueness, so the composite-index concurrent race is validated by the explicit pre-check test + generated migration, not a `MockDb` composite-conflict test.

## Validation

- `pnpm typecheck`, `pnpm lint`, `pnpm test` (new `tak-claim` tests pass).
- `pnpm build` before `pnpm dev` (server code changed).
- `pnpm db:generate` + `pnpm db:migrate` (local D1) — confirm `0006_*.sql` creates the `gifts_user_id_type_unique` index.
- Manual smoke (testnet): log in → `/tak` → claim → balance increases by 3 TAK and button flips to claimed; a second attempt (and a fresh user) is blocked with "already claimed"; temporarily set an empty `GAME_ACCOUNT_SECRET` to see the not-ready/out-of-funds states.

## Risks & edge cases

- **Concurrent double-click**: unique index + insert-first reservation is the hard guard; at most one row per `(userId, type)`. A single user clicking twice near-simultaneously is the only residual risk and is bounded by the reservation insert, not by fund exposure.
- **Transfer landed but client saw a timeout**: the reservation row remains (correctly marks "claimed"); a retry returns `ALREADY_CLAIMED` and the user still holds their 3 TAK. The client should invalidate `tak.status`/refetch balances on success to self-heal.
- **Faucet drained by games**: `claim` checks the casino balance before reserving; if a concurrent game payout drains it, the transfer fails and is surfaced as `CLAIM_FAILED` (reservation deleted, retryable once the casino is refunded).
- **Docs already stale**: `AGENTS.md`/`ARCHITECTURE.md` currently claim "exactly one server-held secret key" even though `GAME_ACCOUNT_SECRET` exists; this change is the right moment to correct that.

## Out of scope

- No `payments` row for claims (bot `history` unchanged).
- No admin UI for claim accounting / faucet balance (reuse the existing admin Casino tab for funds).
- No client-side signing: the claim is fully server-signed from the casino account.
