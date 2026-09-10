# Users Selling TAK (OTC offers on the Get TAK page)

## Goal

Let users list their TAK for sale as **informational offers** shown on the existing
`/tak` (Get TAK) page. An offer states a unit price in **Iranian Rial**, an optional
available amount, and a **memo** with contact instructions. Offers expire after 24h and
must be renewed daily. The page also shows a computed **TAK Price** reference figure.

## Decisions (confirmed)

- **Settlement**: classifieds only. No in-app payment, escrow, or on-chain settlement.
  The buyer contacts the seller via the memo; the trade happens off-app. Consistent with
  the non-custodial + fiat constraints.
- **Price**: integer **Rial per 1 TAK** (Rial has no fractional unit).
- **Amount**: optional; blank = unlimited (sell any amount up to the seller's balance).
  Stored as a stroop string (TAK has 7 decimals); `NULL` = unlimited.
- **One active offer per seller**: enforced with a unique index on `seller_user_id`;
  creating a new offer **replaces** the previous one (upsert).
- **Reference price**: median of active offers' unit prices (integer, rounded).
- **Visibility**: offers (and their contact memos) are shown only to logged-in users.

## Data model

Add to `packages/shared/src/db/schema.ts`:

```ts
export const takOffers = sqliteTable(
  'tak_offers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sellerUserId: integer('seller_user_id').notNull().references(() => users.id),
    priceRial: integer('price_rial').notNull(),       // integer Rial per 1 TAK
    amountStroops: text('amount_stroops'),            // NULL = unlimited
    memo: text('memo').notNull(),                     // contact instructions (plain text)
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => ({
    sellerUnique: uniqueIndex('tak_offers_seller_user_id_unique').on(t.sellerUserId),
    expiresIdx: index('idx_tak_offers_expires').on(t.expiresAt),
  }),
);

export type TakOffer = typeof takOffers.$inferSelect;
```

Constants / helper (new `apps/web/src/server/offers/service.ts`):

- `OFFER_TTL_MS = 24 * 60 * 60 * 1000`.
- `medianPriceRial(prices: number[]): number | null` — sort ascending; odd count → middle;
  even count → `Math.round((a + b) / 2)` of the two middle values; empty → `null`.

## Server

### Zod schema — `packages/shared/src/zod-schemas.ts`

```ts
export const takOfferInputSchema = z
  .object({
    priceRial: z.number().int().positive().max(1_000_000_000),
    amountStroops: stroopsStringSchema.optional(),
    memo: z.string().trim().min(1).max(240),
  })
  .refine((v) => v.amountStroops === undefined || isPositiveStroops(v.amountStroops), {
    message: 'Amount must be greater than zero',
    path: ['amountStroops'],
  });

export type TakOfferInput = z.infer<typeof takOfferInputSchema>;
```

### Service — `apps/web/src/server/offers/service.ts` (NEW)

Mirror the `tak/service.ts` error-contract pattern (`OfferError` + `withOfferErrors` +
`toTrpcOfferError`; typed code carried in `error.message`).

- `list(db, userId)` → `{ offers, referencePriceRial, mine }`
  - `offers`: active offers (`gt(takOffers.expiresAt, new Date())`) ordered
    `asc(takOffers.priceRial)` (then `asc(takOffers.id)` as tiebreak), each joined to
    `users` for `sellerDisplayName` + `sellerPublicKey`, with `isMine` flag. Cap at
    `LIMIT 200`.
  - `referencePriceRial`: median of the active offers' `priceRial`.
  - `mine`: the caller's own offer row (active or expired) or `null`, with an `active`
    boolean (`expiresAt > now`).
- `upsert(db, userId, input)` → insert with `expiresAt = now + OFFER_TTL_MS` using
  `onConflictDoUpdate({ target: takOffers.sellerUserId, set: {...} })` so a seller has at
  most one row. Returns the offer.
- `renew(db, userId)` → update own row `expiresAt = now + OFFER_TTL_MS`;
  `OFFER_NOT_FOUND` if none.
- `remove(db, userId)` → delete own row; no-op if none.

Time source is `new Date()` (UTC epoch ms), consistent with the rest of the schema.

### Router — `apps/web/src/server/trpc/routers/offers.ts` (NEW)

Register in `apps/web/src/server/trpc/router.ts` as `offers: offersRouter`.

- `list` — `protectedProcedure.query` → `withOfferErrors(() => list(...))`.
- `upsert` — `protectedProcedure.input(takOfferInputSchema).mutation`.
- `renew` — `protectedProcedure.mutation` (no input; operates on own offer).
- `delete` — `protectedProcedure.mutation` (no input).

## Client

### `apps/web/src/app/tak/page.tsx`

Extend the existing page (keep the claim button):

1. **TAK Price header** (top): show the reference price in Rial using
   `Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', { maximumFractionDigits: 0 })`.
   When `referencePriceRial` is `null`, show a "no offers yet" placeholder.
2. **Create/edit offer form** (collapsible section): price (integer input), amount
   (optional decimal TAK input converted with `stroopsFromLumens`), memo (text). Submits
   `offers.upsert`; on success invalidates `offers.list`.
3. **Your offer panel** (when `mine` is set): shows price/amount/memo + status, with
   **Renew** (`offers.renew`) and **Delete** (`offers.delete`) buttons.
4. **Offers list**: renders `offers` sorted ascending; each row shows seller display name
   (fallback truncated public key), price `X Rial / TAK`, amount (`formatAmount` of
   `lumensFromStroops` or "unlimited" when null), and the memo as plain text (never
   `dangerouslySetInnerHTML`). Flag `isMine` rows.

Error mapping mirrors `takClaimErrorKey`/`typedCode` in the same file.

### i18n — `apps/web/src/lib/i18n/messages/en.ts` + `fa.ts`

Add keys (English + Persian) under a `tak.offer.*` and `tak.price.*` namespace, e.g.:

- `tak.price.title` ("TAK Price"), `tak.price.noOffers`
- `tak.offer.title`, `tak.offer.priceLabel`, `tak.offer.amountLabel`,
  `tak.offer.amountOptional`, `tak.offer.memoLabel`, `tak.offer.create`,
  `tak.offer.update`, `tak.offer.renew`, `tak.offer.delete`, `tak.offer.unlimited`,
  `tak.offer.sellerFallback`, `tak.offer.rialPerTak`, `tak.offer.yourOffer`,
  `tak.offer.expired`, `tak.offer.errors.*` (validation + `offerNotFound`).

## Tests — `apps/web/test/tak-offers.test.ts` (NEW)

Use `MockDb` (add a `tak_offers` table with `unique: ['sellerUserId']`) and mock the
`drizzle-orm` operators as in `tak-claim.test.ts`. Cover:

- `upsert` creates a row with correct fields and `expiresAt ≈ now + 24h`.
- `upsert` replaces an existing row (still one row, `sellerUserId` unique honored).
- `list` filters expired offers, sorts ascending by price, and computes the median
  (`null` for empty, exact for odd, rounded for even).
- `mine` returns the caller's row with correct `active` flag; `null` when absent.
- `renew` extends `expiresAt`; throws `OFFER_NOT_FOUND` when none.
- `remove` deletes the row; no-op when none.
- zod: reject non-positive price, non-positive amount, empty/overlong memo.

## Migration & validation

1. Edit `schema.ts`, then run `pnpm db:generate` (creates the `0008_*.sql` + snapshot +
   journal entry). Commit the generated files.
2. `pnpm db:migrate` locally.
3. `pnpm typecheck`, `pnpm lint`, `pnpm test`.

## Risks / out of scope

- **Anti-gaming of the reference price**: median includes the viewer's own offer; a
  seller could list a fake price to nudge the displayed "TAK Price". Accepted for v1;
  future work could exclude self offers or weight by on-chain balance.
- **Seller balance is not verified** at offer creation (amount is a soft claim), matching
  the existing trust-based `payments.record` model. On-chain reconciliation is future work.
- **Memo moderation / reporting** and **admin removal** of abusive offers: out of scope.
- **Pagination**: list capped at 200; full pagination is future work.
- **Offline PWA**: the offers list is a live tRPC query; no special offline caching
  beyond the existing service-worker shell.
