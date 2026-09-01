# TakApp: Payments (coffee + P2P), Public Key Reveal, Profile Edit, Admin Shop Editing

## Goal

Ship five user-visible features in the PWA (`apps/web`):

1. Reveal the user's Stellar **public key** in the UI (so they can set `ADMIN_PUBLIC_KEY` in env).
2. **Buy a coffee**: pay **1 TAK** (fixed price) to a coffee shop's owner account.
3. **Send TAK** to another registered user, backed by **user search**.
4. **Edit profile**: change `displayName` (used when sending TAK).
5. **Admin edit coffee shops** (server procedure `admin.updateShop` already exists; add UI).

## Decisions (confirmed with user)

| Decision | Choice |
| --- | --- |
| Coffee price | Fixed **1 TAK per cup**; no price column |
| Shop payment destination | **Shop owner's Stellar account** (`coffee_shops.owner_user_id` → `users.stellar_public_key`); shops without an owner are not payable |
| Payment recording | **Client signs + submits to Horizon**, then reports `txHash` to server, which indexes a `status='submitted'` row (trust-based; per ARCHITECTURE.md "or the client reports the tx hash for indexing") |
| User search | By **displayName substring + public-key prefix** only; emails/phones never exposed |
| TAK acquisition | Add a **claim-gift flow**: server funding account issues 10 TAK to the user (bounded exception: funding account may issue TAK), once per user |

## Schema changes (`packages/shared/src/db/schema.ts`)

- `payments`: add `recipient_public_key text` (nullable) — records the actual destination for P2P and shop payments (name is resolved by join at read time; public key keeps history stable if names change).
- `payments.tx_hash`: make `unique()` — makes `payments.record` idempotent (client retry after network failure must not double-insert).
- `gifts`: reused as-is (`type='tak-welcome'`, `amount='100000000'` = 10 TAK in stroops); presence of such a row = "already claimed".
- Run `pnpm db:generate` then `pnpm db:migrate` to produce/apply the new migration in `apps/web/drizzle`.

## Server changes

### New router `users` (`apps/web/src/server/trpc/routers/users.ts`, register in `router.ts`)
- `me` (protected, query) → `{ publicKey, email, phone, displayName, role }` (reads own profile for the edit form).
- `updateProfile` (protected, mutation), input `{ displayName: z.string().trim().min(1).max(50) }` → updates `users.displayName`, returns updated profile. Reject if trimmed value is empty.
- `search` (protected, query), input `{ query: z.string().trim().min(1).max(60) }` → `SELECT ... FROM users WHERE display_name LIKE %q% OR stellar_public_key LIKE q%` (SQLite `LIKE` is ASCII case-insensitive), `LIMIT 10`, excludes the caller, returns `[{ publicKey, displayName }]`.

### New router `payments` (`apps/web/src/server/trpc/routers/payments.ts`, register in `router.ts`)
- `record` (protected, mutation), input:
  - `txHash: z.string().min(1).max(100)`
  - `amount: stroopsStringSchema` (positive, non-zero)
  - `asset: z.enum(['TAK', 'XLM'])`
  - exactly one of `coffeeShopId?: int>0` or `recipientPublicKey?: stellarAccountIdSchema`
- Logic:
  - If `coffeeShopId`: load shop → require `isActive` (else `NOT_FOUND`), require an owner (else `PRECONDITION_FAILED` "Shop has no payment account"); set `recipient_public_key` = owner's key.
  - If `recipientPublicKey`: require a `users` row exists for it (else `NOT_FOUND`); reject if it equals caller's key (else `CONFLICT`).
  - Insert `payments` row (`userId=ctx.user.id`, `status='submitted'`) with `onConflictDoNothing` on `tx_hash`; if no row inserted, load existing by `txHash` and return its id (idempotent).
  - Return `{ ok: true, id }`.

### New wallet procedure `claimGift` (`apps/web/src/server/trpc/routers/wallet.ts`)
- Guard: reject if a `gifts` row with `type='tak-welcome'` exists for the user (`CONFLICT`, "Gift already claimed").
- Pre-check TAK trustline via existing `hasTrustline(server, user.stellarPublicKey, takIssuer)`; if absent → `PRECONDITION_FAILED`.
- Call new server helper `sendTakGift` (funding account → user, `Asset('TAK', takIssuer)`, 10 TAK), insert `gifts` row, return `{ amount: '100000000' }`.
- Wrap D1 writes so the gift row is only inserted after a successful send.

### Stellar helper (`apps/web/src/server/stellar/funding.ts`)
- Export `submitTransactionToHorizon` (currently private) so the gift path can reuse the same bounded, logged Horizon submission.
- Add `sendTakGift({ horizonUrl, networkPassphrase, fundingSecret, takIssuer, destination })`: load funding account, build `Operation.payment({ destination, asset: new Asset('TAK', takIssuer), amount: '10' })`, fee `'100'`, timeout 30, sign, submit; surface Horizon failure details.

### `shops.list` (`apps/web/src/server/trpc/routers/shops.ts`)
- Include `ownerPublicKey` (owner's `users.stellar_public_key` or `null`) in the returned rows so the client knows the destination for the buy-coffee flow (public data; the shop owner key is on-chain anyway).

## Signing Web Worker changes

- `apps/web/src/workers/messages.ts`: add request payload
  `{ type: 'submit-payment'; secretKey; destination; assetCode; assetIssuer; amount; horizonUrl; networkPassphrase }` (`amount` = lumens decimal string, what the SDK expects).
- `apps/web/src/workers/stellar-worker.ts`: add `submit-payment` case — validate destination ≠ source and `amount` parses > 0, build `Operation.payment({ destination, asset: new Asset(assetCode, assetIssuer), amount })` on the account, `fee '100'`, `setTimeout(60)`, sign, POST to `{horizonUrl}/transactions` (same bounded-fetch pattern as `submit-change-trust`), respond `{ type: 'submitted', txHash }`.
- `apps/web/src/workers/stellar-worker-client.ts`: add `submitPayment(input): Promise<string>` (txHash).

## UI changes

### `apps/web/src/components/wallet-shell.tsx` — balance phase becomes a dashboard
- **Session secret caching**: keep the decrypted `secretKey` in a new ref after `runLogin`/signup (cleared on logout) so payments don't re-prompt every time. If a payment is initiated and the ref is empty (e.g. after a page reload), show a small inline password prompt that re-derives/decrypts the key via existing `deriveEncryptionKey` + `decryptSecret` and caches it. Password is never persisted in state beyond the decrypted key in memory.
- **1. Public key reveal**: "My address" card showing `getSession().publicKey` in a `break-all` mono `<code>` block with a **Copy** button (`navigator.clipboard`). Works with no server call.
- **2. Buy coffee**: list active shops from `trpc.shops.list`; per shop show name/address and **"Buy coffee (1 TAK)"**. Flow: `worker.submitPayment({ secretKey, destination: shop.ownerPublicKey, assetCode: 'TAK', assetIssuer: takIssuer (from `wallet.networkConfig`), amount: '1', horizonUrl, networkPassphrase })` → `trpc.payments.record({ txHash, amount: '10000000', asset: 'TAK', coffeeShopId: shop.id })` → refetch `wallet.balance`. Show Horizon failure detail (e.g. `op_underfunded`) as the error message.
- **3. Send TAK**: search input (debounced `trpc.users.search`), pick a recipient from results (displayName + truncated key), amount input in TAK (validated via `stroopsFromLumens`, up to 7 decimals, `> 0`, recipient ≠ self), **Send** button → `submitPayment` → `payments.record({ txHash, amount: <stroops>, asset: 'TAK', recipientPublicKey })` → refetch balances.
- **4. Profile**: show current displayName from `trpc.users.me`; input + **Save** → `trpc.users.updateProfile`; show updated name.
- **5. Claim gift**: **"Claim 10 free TAK"** button → `trpc.wallet.claimGift` → refetch balances; on `CONFLICT` show "Gift already claimed". (No verification gate for v1; verification stays stubbed.)

### `apps/web/src/components/admin-panel.tsx` — ShopsTab edit
- Per shop add an **Edit** button toggling an inline form (name, address, active checkbox, ownerPublicKey) wired to the existing `trpc.admin.updateShop`; refetch `admin.listShops` after save. Keep existing create/disable.

## Files to change (ordered)

1. `packages/shared/src/db/schema.ts` — payments `recipient_public_key` + unique `tx_hash`.
2. `packages/shared/src/zod-schemas.ts` — `updateProfileSchema`, `userSearchSchema`, `paymentRecordSchema` (shared types).
3. `apps/web/drizzle/*` — new migration (`pnpm db:generate`).
4. `apps/web/src/server/stellar/funding.ts` — export submit helper; add `sendTakGift`.
5. `apps/web/src/server/trpc/routers/users.ts` (new), `payments.ts` (new), `router.ts` (register), `wallet.ts` (`claimGift`), `shops.ts` (`ownerPublicKey`).
6. `apps/web/src/workers/messages.ts`, `stellar-worker.ts`, `stellar-worker-client.ts` — `submit-payment`.
7. `apps/web/src/components/wallet-shell.tsx` — dashboard (features 1–5 user-facing).
8. `apps/web/src/components/admin-panel.tsx` — shop edit UI.
9. `ARCHITECTURE.md` — document claim-gift flow, users/payments routers, P2P + shop payment flow, `recipient_public_key`, public-key reveal; keep "server never signs user transactions" statement accurate (server only issues TAK gifts via the bounded funding account).

## Tests (`pnpm test`)

- `apps/web/test/payments.test.ts` (new): `record` with neither/both of shop+recipient → error; inactive shop → `NOT_FOUND`; shop without owner → `PRECONDITION_FAILED`; unknown recipient → `NOT_FOUND`; self-recipient → `CONFLICT`; duplicate `txHash` → idempotent (no double row).
- `apps/web/test/users.test.ts` (new): `updateProfile` empty/whitespace/over-50 → error, valid → updates; `search` matches displayName substring + public-key prefix, excludes caller, limits to 10.
- `apps/web/test/claim-gift.test.ts` (new): success inserts gift + issues TAK; second claim → `CONFLICT`; missing trustline → `PRECONDITION_FAILED`; funding send failure → no gift row.
- Existing suites must stay green (bot `listPayments` unaffected by added column).

## Validation

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, then `pnpm build` (needed before `pnpm dev` picks up server changes).
- Manual smoke (dev, testnet): sign up → trustline → claim 10 TAK → balance shows TAK → reveal/copy public key → buy a coffee at a shop with an owner → send TAK to a searched user → edit displayName → (admin) edit a shop's name/address/active/owner.
- Confirm `payments` rows appear in D1 with `recipient_public_key` and status `submitted`.

## Risks / open items

- Trust-based payment indexing: client could report a fake `txHash`. Accepted for v1 per decision; note in `ARCHITECTURE.md` that on-chain reconciliation is future work.
- Shops without an owner cannot accept payments (by design); admin UI must let admins set an owner.
- Users need a TAK trustline to receive gifts/payments; all signup-created accounts establish it. Horizon surfaces `op_no_trust`/`op_underfunded` details otherwise.
- Claim-gift is currently un-gated by verification (verification remains stubbed); revisit when verification UI lands.
