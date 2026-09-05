# Coffee Ordering Flow — Implementation Plan

## Goal

Implement the full order scenario: home → (near-shop auto-select | shops list) → order page (menu +/-, total, Pay) → TAK transfer → order recorded → owner notified (Web Push) → owner marks ready → customer notified (Web Push), plus a customer order-status list.

## Resolved decisions

- **Notifications**: real Web Push (Service Worker + VAPID), background delivery.
- **Auto-select threshold**: 50 m — if the nearest active shop is ≤ 50 m, go straight to its order page.
- **Customer view**: push notification **plus** a "My orders" status list.
- **Payment granularity**: one on-chain TAK transfer of the summed cart total, recorded as one order + one `payments` row, idempotent on tx hash.
- **Server-authoritative totals**: the server recomputes the total from menu prices; rejects if it differs from the signed amount (menu changed mid-order).

## Data model (edit `packages/shared/src/db/schema.ts`)

Add three tables and one column; export their types.

```ts
export const orders = sqliteTable('orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  coffeeShopId: integer('coffee_shop_id').notNull().references(() => coffeeShops.id),
  totalAmount: text('total_amount').notNull(),          // stroops string
  status: text('status').notNull().default('placed'),    // 'placed' | 'ready'
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  readyAt: integer('ready_at', { mode: 'timestamp_ms' }),
});

export const orderItems = sqliteTable('order_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: integer('order_id').notNull().references(() => orders.id),
  menuItemId: integer('menu_item_id').references(() => menuItems.id),
  name: text('name').notNull(),            // snapshot for stable order text
  unitPrice: text('unit_price').notNull(),  // snapshot, stroops string
  quantity: integer('quantity').notNull(),
});

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});
```

- `payments`: add nullable `orderId: integer('order_id').references(() => orders.id)`. `payments.record` (P2P `/send`) is unchanged; `orders.place` also inserts a `payments` row with `orderId` set so bot history and money history stay intact.

Money helper: add `mulStroops(a: string, n: number): string` to `packages/shared/src/money.ts` (BigInt multiply) for `unitPrice * quantity`.

Zod (edit `packages/shared/src/zod-schemas.ts`): add `orderItemInputSchema` (`{ menuItemId: int>0, quantity: int 1..999 }`), `placeOrderSchema` (`{ shopId, items: array min 1 max 50, amount: stroopsString, txHash }`), `markOrderReadySchema` (`{ orderId }`), `pushSubscriptionSchema` (`{ endpoint, p256dh, auth }`). Export input types.

## Server changes

### New router `apps/web/src/server/trpc/routers/orders.ts` (register in `router.ts`)

- `place` (protected, `placeOrderSchema`): load active shop + owner (reuse `payments.record` validation logic); load menu items, ensure all belong to the shop and no duplicate `menuItemId`; compute `total = Σ mulStroops(unitPrice, quantity)`; if `total !== input.amount` throw `CONFLICT` ("menu changed"); idempotency: first check existing `payments` by `txHash` and return the linked order if present, else insert `orders` (placed) + `orderItems` (snapshot name/unitPrice/quantity) + `payments` (amount=total, asset 'TAK', coffeeShopId, orderId, txHash, status 'submitted') in one `db.batch`; then best-effort `notifyUser(owner)` (fire-and-forget). Return `{ orderId, totalAmount }`.
- `my` (protected): the caller's orders (join shop name + order items + status + createdAt), newest first.
- `listForOwner` (protected): orders for shops owned by `ctx.user`, with items text (`1 ESPRESSO + 1 Latte` derived from snapshot name + quantity), customer (display name + public key), status, createdAt; newest first.
- `markReady` (protected, `markOrderReadySchema`): load order; require `assertCanEditShop` on `order.coffeeShopId` (owner or admin); require status `'placed'` else `CONFLICT`; set `status='ready'`, `readyAt=now`; `notifyUser(order.userId)` (customer).

### `shops.ts`

- Add `get` (public, `{ id }`) returning one shop + `ownerPublicKey` + menu (reuse `attachMenus`).
- Add `listForMe` (protected) returning the same shape as `list` plus per-shop `previousOrderCount` (count of `orders` for `coffeeShopId` by `ctx.user.id`). Keep `list` public (bot-compatible).

### Web Push module — new `apps/web/src/server/push/web-push.ts`

Implement RFC 8291 (payload encryption) + RFC 8292 (VAPID) using **Web Crypto only** (Workers-safe, per AGENTS.md "no Node-only APIs"):
- VAPID JWT (ES256) signed with `jose` (already a dependency) using `VAPID_PRIVATE_KEY`/`VAPID_PUBLIC_KEY`, `sub: VAPID_SUBJECT`.
- Payload: ECDH (P-256) with subscription `p256dh`, HKDF-SHA256 key derivation, AES-128-GCM (`auth` secret as salt); `Content-Encoding: aes128gcm`.
- `notifyUser(db, userId, { title, body })`: load `pushSubscriptions` for user, `fetch(endpoint)` each; delete subscriptions returning 404/410. All sends best-effort (errors logged, never thrown to the caller).

> Risk note: this is the highest-risk item. If a Workers-compatible `web-push` library is confirmed during implementation, it may be used instead; otherwise the small internal module above is required. Add a Vitest round-trip test using a generated keypair.

### `push` router — new `apps/web/src/server/trpc/routers/push.ts` (register in `router.ts`)

- `publicKey` (public) → `{ vapidPublicKey: env.VAPID_PUBLIC_KEY }`.
- `subscribe` (protected, `pushSubscriptionSchema`): upsert subscription for `ctx.user` (unique endpoint).
- `unsubscribe` (protected, `{ endpoint }`): delete.

### Env (`env.ts` + `wrangler.toml`)

- `WorkerEnv`: add `VAPID_PUBLIC_KEY: string`, `VAPID_PRIVATE_KEY: string`, `VAPID_SUBJECT: string`.
- `wrangler.toml` `[vars]`: `VAPID_PUBLIC_KEY` + `VAPID_SUBJECT` (public); `VAPID_PRIVATE_KEY` via `wrangler secret` (not committed). Repeat in `[env.preview.vars]`.

## Client changes (`apps/web/src`)

### Service worker — edit `app/sw.ts`

Add `push` and `notificationclick` handlers (outside `serwist.addEventListeners()`):
- `push`: parse `event.data.json()` → `self.registration.showNotification(title, { body, icon, tag, data })`.
- `notificationclick`: close, focus existing window or `clients.openWindow('/')` (route by `event.notification.data.url` if present).

### Push registration — new `lib/push.ts`

- `urlBase64ToUint8Array`, `enablePush()`: `Notification.requestPermission()` → if granted, `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` → `trpc.push.subscribe.mutate({ endpoint, p256dh, auth })`. Called lazily: customer after first successful order (and via a toggle on `/orders`); owner when opening the orders view.

### Wallet provider — edit `lib/wallet-provider.tsx`

- Add `placeOrderMutation = trpc.orders.place.useMutation()` and a new `submitOrder(input)` action mirroring `submitPayment` but: single `worker().submitPayment({ amountRaw: total, destination: ownerPublicKey })`, then `placeOrderMutation.mutateAsync({ shopId, items, amount: total, txHash })`, then `balanceQuery.refetch()`. Reuse existing `signPayment`/password-prompt plumbing unchanged.

### Routes/components

- **`components/home-dashboard.tsx`**: replace the `Buy Coffee` `<Link>` with a `BuyCoffeeButton` client component that on click `getCurrentPosition()` + `shops.listForMe`, computes nearest distance, and `router.push('/order/'+id)` if ≤ 50 m, else `/buy`; on geolocation failure → `/buy`.
- **`app/buy/page.tsx`** (shops list): add search input (filter name/address, case-insensitive); sort = distance when location known, else `previousOrderCount` desc (ties by name); each shop becomes a "select" row → `router.push('/order/'+id)` (remove per-item instant-buy). Keep "Use my location".
- **New `app/order/[shopId]/page.tsx`** (`'use client'`, `useParams`): `shops.get` → render name/address/quote; menu items as stepper rows (per-item quantity state, `+`/`-`, min 0); total = `Σ mulStroops(price, qty)` (computed client-side with the shared helper); "Select Coffee Shop" → `/buy`; "Pay / Order" (disabled when total is 0 or `busy`) → `signPayment` → `submitOrder`; on success show confirmation, `enablePush()` for the customer, link to `/orders`.
- **New `app/orders/page.tsx`** (`'use client'`): list `orders.my` (shop, item text, status badge placed/ready, time) + "Enable notifications" toggle.
- **Owner orders** — new `components/owner-orders.tsx` rendered on `app/owner/page.tsx` (below the shop editor): lists `orders.listForOwner` (order text, customer, time), each with a "Mark ready" button → `orders.markReady`; `refetchInterval` ~15 s as a polling fallback; `enablePush()` on mount so the owner opts into Web Push.
- **`components/nav-bar.tsx`**: add `/orders` entry (label "My Orders") for all logged-in users.

### i18n

Add `en`/`fa` keys (in `lib/i18n/messages/*.ts`) for: search placeholder, "Select", order page (quote label, menu, quantity, total, "Pay", "Select coffee shop", empty cart), orders list ("My orders", placed/ready, "Enable notifications"), owner orders ("Orders", "Mark ready", "New order", no orders), and push notification copy ("New order", "Your order is ready").

## Payment / notification flow (end-to-end)

1. Customer taps Pay → Web Worker signs one TAK transfer of the total to the owner's public key → Horizon submit (existing `worker().submitPayment`).
2. `orders.place` validates + persists order/items/payment (idempotent on tx hash), recomputes total server-side.
3. Server `notifyUser(owner)` → Web Push to all owner devices: "New order".
4. Owner opens `/owner` orders list → sees order text + customer → "Mark ready".
5. `orders.markReady` sets `ready` → `notifyUser(customer)` → "Your order is ready".

## Failure modes to cover in tests (Vitest)

- `mulStroops` (overflow-safe, quantity 0/1/many).
- `orders.place`: inactive shop; unknown/mismatched item; empty items; quantity 0; total mismatch → `CONFLICT`; duplicate `txHash` → idempotent (returns existing order, no double insert).
- `orders.listForOwner` / `markReady`: non-owner → `FORBIDDEN`; already-ready → `CONFLICT`; missing order → `NOT_FOUND`.
- `push.subscribe`/`unsubscribe` auth.
- Web Push: VAPID JWT + payload encryption round-trip (fake endpoint).
- Auto-select: pure function "nearest shop ≤ 50 m" unit test.

## Validation steps

1. `pnpm db:generate` → inspect generated SQL → `pnpm db:migrate` (local D1).
2. `pnpm typecheck`, `pnpm lint`, `pnpm test`.
3. Manual (needs testnet + two devices/profiles): create owner user + shop/menu (admin/owner), customer places order, confirm owner push, mark ready, confirm customer push; verify idempotent retry after a simulated network failure.

## Out of scope (unchanged/future)

- On-chain reconciliation of order payments (existing accepted future work).
- Order cancellation/refunds (no `cancelled` state).
- Offline ordering (order page needs live menu + network for payment; service worker still caches the shell).
- Bot-side order actions (bot stays read-only).

## Ordered task list

1. Schema + `mulStroops` + zod schemas; `pnpm db:generate`.
2. Web Push module + `push` router + env (`VAPID_*`, wrangler.toml) + service-worker push/click handlers.
3. `orders` router (`place`, `my`, `listForOwner`, `markReady`) + `shops.get`/`shops.listForMe`; register routers.
4. Wallet provider `submitOrder`.
5. Client UI: `BuyCoffeeButton`, `/buy` search/sort, `/order/[shopId]`, `/orders`, owner orders, nav entry, `lib/push.ts`.
6. i18n en/fa keys.
7. Tests (money, orders router, push round-trip, auto-select).
8. `pnpm db:migrate`, `pnpm typecheck`, `pnpm lint`, `pnpm test`; update `ARCHITECTURE.md`.
