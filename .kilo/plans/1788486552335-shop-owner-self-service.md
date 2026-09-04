# Shop Owner Self-Service: edit shop, menu, quote, GPS

## Goal

Let a coffee-shop owner edit their own shop from the PWA: name, address, Quote of the Day, menu (items priced in TAK), and GPS location. Clients then use the shop's GPS to find/near-sort shops when they tap Buy, and pay per menu item.

## Resolved decisions

1. **Buy flow** — customers pick a menu item and pay that item's TAK price (replaces the hardcoded fixed `1 TAK`). Destination stays the shop owner's Stellar account.
2. **GPS** — client-side proximity: browser `navigator.geolocation` + haversine sorting; nearest shop highlighted. No user location is sent to the server; works offline (graceful fallback to plain list).
3. **Menu editing** — owner edits the whole menu in one form; the server replaces all `menu_items` for a shop in one D1 batch (atomic).
4. **Payment history** — record `menu_item_id` on `payments` so history shows what was bought.
5. **Admin scope** — admins also manage the new fields (quote, GPS, menu) via the existing admin panel.
6. **Ownership model** — single owner via `coffee_shops.owner_user_id` (no new `role`). An owner may edit only their own shops; admins may edit any. Introduced via a new `owner` tRPC router (session token, `protectedProcedure`), not a new role.

## Affected boundaries

- `packages/shared/src/db/schema.ts` — schema is the DB source of truth.
- `packages/shared/src/zod-schemas.ts` — validation.
- `apps/web/src/server/trpc/routers/*` — shops, owner (new), admin, payments.
- `apps/web/src/app/buy`, new `apps/web/src/app/owner`, `components/owner-panel.tsx`, `components/admin-panel.tsx`, `components/nav-bar.tsx`, `lib/wallet-provider.tsx`.
- `apps/web/src/lib/i18n/messages/*` — en/fa strings.
- `ARCHITECTURE.md` — data model + flows.

## Money convention

Menu prices are **stroops strings** (`packages/shared/src/money.ts`). TAK has 7 decimals, so `1 TAK = 10000000` stroops. Owners enter a TAK decimal (e.g. `1.5`); the client converts with `stroopsFromLumens` before sending. Server stores/compares the stroops string only.

---

## Tasks

### 1. Schema (`packages/shared/src/db/schema.ts`)

- Add to `coffeeShops`:
  - `quoteOfTheDay: text('quote_of_the_day')`
  - `latitude: real('latitude')` (SQLite REAL; GPS is not money, floats fine)
  - `longitude: real('longitude')`
- Add new `menuItems` table:
  ```ts
  export const menuItems = sqliteTable('menu_items', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    coffeeShopId: integer('coffee_shop_id').notNull().references(() => coffeeShops.id),
    name: text('name').notNull(),
    price: text('price').notNull(), // stroops string
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  });
  ```
- Add to `payments`: `menuItemId: integer('menu_item_id').references(() => menuItems.id)`.
- Export `MenuItem` type.

### 2. Migration

- Run `pnpm db:generate` (writes `apps/web/drizzle/0003_*.sql`) then `pnpm db:migrate`.
- New migration: `ALTER TABLE coffee_shops ADD quote_of_the_day text; ADD latitude real; ADD longitude real;` `CREATE TABLE menu_items (...)` `ALTER TABLE payments ADD menu_item_id integer;`.

### 3. Shared zod schemas (`packages/shared/src/zod-schemas.ts`)

- `menuItemInputSchema = z.object({ name: z.string().trim().min(1).max(120), price: stroopsStringSchema })` with positive-price refine (`price !== '0'`, or `isPositiveStroops`).
- `shopLocationSchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })`.
- `quoteOfTheDaySchema = z.string().trim().max(240)`.
- Extend `paymentRecordSchema`:
  - `menuItemId: z.number().int().positive().optional()`
  - refine: `menuItemId !== undefined` implies `coffeeShopId !== undefined`.

### 4. Shared shop service (`apps/web/src/server/shop/service.ts`, new)

Pure helpers reused by owner + admin routers:

- `assertCanEditShop(db, user, envAdminKey, shopId)` → loads the shop; throws `NOT_FOUND` if missing, `FORBIDDEN` unless `shop.ownerUserId === user.id` or `isAdminUser(user, envAdminKey)`; returns the shop.
- `saveMenuForShop(db, shopId, items)` → validate positive prices, then `db.batch`: delete all `menu_items` for the shop, insert each item with `sortOrder = index`, `createdAt = now`.

### 5. `shops.ts` router — `list`

Return, per active shop: `id, name, address, quoteOfTheDay, latitude, longitude, ownerPublicKey, menu: [{ id, name, price }]`.

- Query active shops (existing leftJoin with owner), query all `menu_items` for those shop ids, group by `coffeeShopId` in JS, order by `sortOrder, id`. Avoid N+1.

### 6. New `owner` router (`apps/web/src/server/trpc/routers/owner.ts`)

Register in `router.ts` as `owner`.

- `mine` (`protectedProcedure.query`) → shops where `ownerUserId === ctx.user.id`, each with full fields + menu (reuse the same shaping as `shops.list`).
- `update` (`protectedProcedure.input`) — input `{ id, name?, address?, quoteOfTheDay?, latitude?, longitude? }`; `assertCanEditShop`; map `''` → `null` for `address`/`quoteOfTheDay`; `null` clears `latitude`/`longitude`; return `{ ok: true }`.
- `saveMenu` (`protectedProcedure.input({ shopId, items: z.array(menuItemInputSchema) })`) — `assertCanEditShop` then `saveMenuForShop`; return `{ ok: true }`.

### 7. `admin.ts` router — extend

- `createShopInput` + `updateShopInput`: add `quoteOfTheDay?`, `latitude?`, `longitude?` (with clear semantics as above).
- `createShop` / `updateShop` persist the new fields.
- `listShops` / `createShop` return the new fields + menu (or at least quote/lat/lng).
- Add `saveMenu` (`adminProcedure.input({ shopId, items })`) → `saveMenuForShop`.

### 8. `payments.ts` router — `record`

- Accept `menuItemId`. When present: require `coffeeShopId`, load the item, verify `item.coffeeShopId === coffeeShopId` (else `BAD_REQUEST`/`NOT_FOUND`), and set the recorded `amount` to the item's stored price (server-authoritative, prevents indexing a price lower than the menu).
- Persist `menuItemId`.

### 9. Client: geolocation helper (`apps/web/src/lib/geo.ts`, new)

- `getCurrentPosition(): Promise<{ latitude: number; longitude: number }>` wrapping `navigator.geolocation.getCurrentPosition` (reject with a translatable message on denial/unavailable).
- `distanceMeters(a, b): number` (haversine).

### 10. Client: Buy page (`apps/web/src/app/buy/page.tsx`)

- Add optional "Use my location" button → `getCurrentPosition()` → sort `shops.list` results by `distanceMeters`, show distance, highlight nearest ("you are here").
- Without location, keep the existing flat list (offline-compatible).
- Render each shop's menu items; selecting an item calls `signPayment`/`submitPayment` with the item's `price` (instead of `'10000000'`) and `menuItemId`.
- Show `quoteOfTheDay` when present. Keep the "no payment account" guard (`ownerPublicKey` null).

### 11. Client: wallet provider (`apps/web/src/lib/wallet-provider.tsx`)

- Extend `PaymentInput` with `menuItemId?: number`.
- In `submitPayment`, forward `menuItemId` to `payments.record` when defined.

### 12. Client: owner UI

- New route `apps/web/src/app/owner/page.tsx` + `apps/web/src/components/owner-panel.tsx`:
  - `owner.mine` query; if empty, show a "no shops" message.
  - Edit form per shop: name, address, Quote of the Day, GPS (numeric lat/lng + "Use my location" button that fills from `getCurrentPosition()`).
  - Menu editor: list of rows (name + TAK decimal price), add/remove row, "Save menu" (converts decimal → stroops via `stroopsFromLumens`, calls `owner.saveMenu`).
  - Reuse the existing coffee Tailwind styling patterns from `admin-panel.tsx`.

### 13. Client: nav + admin panel

- `nav-bar.tsx`: show a "My Shop" (`/owner`) link when `owner.mine` returns ≥1 shop (lightweight query gated by `session`).
- `admin-panel.tsx` `ShopsTab`: extend edit form with Quote of the Day, lat/lng (+ "Use my location"), and a per-shop menu editor (name+price rows, save via `admin.saveMenu`).

### 14. i18n (`apps/web/src/lib/i18n/messages/en.ts` + `fa.ts`)

Add keys under `owner.*` (title, name, address, quote, location, useMyLocation, menu, menuItemName, menuItemPrice, addItem, saveMenu, noShops, saving), `buy.*` (useMyLocation, nearest, menu, distance), and any new admin strings. Keep `fa` translations.

### 15. Tests

- New `apps/web/test/owner.test.ts`:
  - `owner.mine` lists only the caller's shops.
  - `owner.update` rejects non-owner (`FORBIDDEN`), allows owner, allows admin; empty-string → null clearing.
  - `owner.saveMenu` replaces items (old items gone), validates empty price/name, enforces ownership.
  - lat/lng bounds rejected by zod.
- Extend `apps/web/test/payments.test.ts`:
  - `menuItemId` without `coffeeShopId` → `BAD_REQUEST`.
  - `menuItemId` from a different shop → rejected.
  - menu purchase records the item's stored price + `menuItemId`.
- Extend `packages/shared/test/zod-schemas.test.ts`: menu item schema, location bounds, `paymentRecordSchema.menuItemId` refine.

### 16. Docs

Update `ARCHITECTURE.md`:
- Data Model: `coffee_shops` gains `quote_of_the_day`, `latitude`, `longitude`; add `menu_items`; `payments.menu_item_id`.
- Admin/owner section: owner self-service is now implemented (not "later plan"); describe owner router + `assertCanEditShop`.
- Key Flows → Pay: item-based pricing + proximity; UI Structure: add `/owner`.

## Validation

1. `pnpm db:generate` then `pnpm db:migrate` (local D1).
2. `pnpm typecheck`.
3. `pnpm lint`.
4. `pnpm test`.
5. `pnpm build` then `pnpm dev` smoke test: owner edits quote/menu/location, buy page shows menu + location sort, pay an item, history shows the item.

## Risks / notes

- **D1 atomicity** — menu replace uses `db.batch()` (drizzle-orm/d1), which maps to D1's atomic `batch()`; avoid a read-modify-write loop.
- **Floats for GPS only** — lat/lng are not money; `real` is acceptable (~6 decimal places). Never use floats for TAK amounts.
- **Non-custodial / trust-based index** — `payments.record` still trusts the client `tx_hash`; making the menu amount server-authoritative only improves the indexed amount, not on-chain enforcement (client signs the actual transfer).
- **Geolocation needs secure context** — PWA is HTTPS in prod, `localhost` in dev; degrade gracefully offline/denied.
- **No `role='owner'`** — ownership is `coffee_shops.owner_user_id`; document this so it is not mistaken for a new role.
