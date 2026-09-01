# Split the single-page app into routed pages (Home / Buy / Send / Admin)

## Context

Today every feature lives on one route (`/`) driven by `apps/web/src/components/wallet-shell.tsx` (754 lines). It owns:
- auth phases: `welcome`, `signup`, `mnemonic`, `trustline`, `login`
- a `balance` phase containing: address + copy, balances, free-TAK claim, buy-coffee (shops list), send-TAK (search + amount), profile, and the admin panel
- shared payment state: decrypted secret key in memory (`sessionSecretRef`), network config query, password prompt modal, `doPayment`

Goal: real pages with a menu. `/` becomes the home (auth flow when logged out, account overview + navigation buttons when logged in). Buy Coffee, Send TAK, and Admin Panel move to their own routes.

All needed server data already exists via tRPC (`shops.list`, `users.search`, `users.me`, `admin.status`, `wallet.networkConfig`, `wallet.balance`, `payments.record`). No server/DB/router changes are required.

## Decisions (confirmed with user)

1. **Real routes** in the Next.js App Router: `/`, `/buy`, `/send`, `/admin`.
2. **Home page** keeps the account overview (address, balances, free-TAK claim, profile) and shows the three navigation buttons (Buy Coffee, Send TAK, Admin Panel if admin).
3. **Top nav bar** menu (Home, Buy Coffee, Send TAK, Admin if admin, Log out) visible on all authenticated pages, hidden during the auth flow.
4. **Auth flow stays on `/`**: when no session, `/` renders the existing welcome/signup/mnemonic/trustline/login flow; after login it swaps to the hub.

## New page structure

```
/               home — logged out: AuthFlow; logged in: HomeDashboard (account overview + buttons)
/buy            Buy coffee — shops list, "Buy coffee (1 TAK)" per shop
/send           Send TAK — recipient search + amount
/admin          Admin panel (TOTP step-up, shops/users management)
```

## Implementation steps

### 1. Create `apps/web/src/lib/wallet-provider.tsx` (new, `'use client'`)

React context shared by all authenticated pages. Owns what `WalletShell` currently holds per-page:

- `session: SessionRecord | null` — init from `getSession()`, updated by `completeLogin`.
- `secretKey` (in-memory, `useRef`) — decrypted at login or via the password modal.
- `signPayment(action: (secretKey: string) => Promise<void>)` — if `secretKey` is present, run the action immediately (with `busy`); otherwise open the password prompt storing the pending action (move `startPayment`/`submitPaymentPassword`/`cancelPaymentPassword` logic here).
- Password modal rendered by the provider as a fixed-position overlay (so it works from `/buy` and `/send`), with `busy`/`error`/`passwordError` state.
- `networkConfigQuery` (`trpc.wallet.networkConfig`, `enabled: !!session`).
- `balanceQuery` (`trpc.wallet.balance`, `enabled: !!session`) + `refetchBalances()`.
- `submitPayment(input)` — move `doPayment` here: requires network config, calls `worker().submitPayment` with `withTimeout`, `trpc.payments.record`, then `refetchBalances`.
- `completeLogin(token, publicKey, secretKey)` — `saveSession` + set state + store secret.
- `logout()` — `clearSession()`, `clearAdminToken()`, clear secret ref, close password modal.
- Move helpers `withTimeout`, `ATTEMPT_TIMEOUT_MS`, and the lazy `worker()` client (from `stellar-worker-client`) into this file.

### 2. Create `apps/web/src/components/auth-flow.tsx` (new)

Extract the auth phases (`welcome`/`signup`/`mnemonic`/`trustline`/`login`) from `wallet-shell.tsx` unchanged in behavior:
- Owns `phase`, `flowRef`, `credentialsRef`, `trustlineSubmittedRef`, the signup/challenge/login/clientLog mutations, `beacon`, and the trustline auto-submit effect.
- Keeps its own `networkConfigQuery` for the trustline step (`enabled: phase === 'trustline'`; same query key as the provider's, so react-query dedupes — the two are never enabled simultaneously).
- `runLogin` calls `completeLogin(result.token, publicKey, secretKey)` from the provider instead of setting `sessionSecretRef`/`phase` directly.
- Renders its own `<main>` layout; no header, no logout, no balance content.

### 3. Create `apps/web/src/components/nav-bar.tsx` (new, `'use client'`)

- `const { session, logout } = useWallet()`; render `null` when `!session`.
- Header row: app title + Log out button (as today).
- Nav links with `next/link`: Home (`/`), Buy Coffee (`/buy`), Send TAK (`/send`), Admin Panel (`/admin` only when admin).
- Admin check: `trpc.admin.status.useQuery(undefined, { enabled: !!session, retry: false })`; `isAdmin = data?.role === 'admin'`.
- Highlight the active link with `usePathname()`.
- Style to match existing `coffee-*` Tailwind tokens.

### 4. Create `apps/web/src/components/home-dashboard.tsx` (new)

Rendered by `/` when logged in. Reuses the current balance-phase sections minus buy/send/admin:
- Address + copy button.
- Balances from `useWallet().balanceQuery`.
- Free-TAK claim (`trpc.wallet.claimGift` + `refetchBalances`).
- Profile display name (`trpc.users.me` for initial value, `trpc.users.updateProfile`).
- Three prominent buttons: Buy Coffee → `/buy`, Send TAK → `/send`, Admin Panel → `/admin` (admin check via `trpc.admin.status`, same deduped query as NavBar).
- Error/busy rendering consistent with today.

### 5. Rewrite `apps/web/src/app/page.tsx` (client component)

```
'use client';
const { session } = useWallet();
return session ? <HomeDashboard /> : <AuthFlow />;
```

### 6. Create `apps/web/src/app/buy/page.tsx` (new, `'use client'`)

- Guard: if `!session`, render "Please log in" + link to `/`.
- `trpc.shops.list` (enabled when session); render shops list like today.
- Buy button → `signPayment((secretKey) => submitPayment({ secretKey, destination: shop.ownerPublicKey, amountLumens: '1', stroops: '10000000', coffeeShopId: shop.id }))`, preserving the "shop has no payment account" error.
- Show provider error/busy states.

### 7. Create `apps/web/src/app/send/page.tsx` (new, `'use client'`)

- Guard as above.
- Move the debounced search, recipient select, self-send check, and amount validation (`stroopsFromLumens` / `isPositiveStroops` from `@takapp/shared/money`) from `wallet-shell.tsx`.
- Send → `signPayment((secretKey) => submitPayment({ secretKey, destination: recipient.publicKey, amountLumens, stroops, recipientPublicKey: recipient.publicKey }))`.

### 8. Create `apps/web/src/app/admin/page.tsx` (new, `'use client'`)

- Guard: require session.
- Render `<AdminPanel />`; if `role !== 'admin'`, AdminPanel renders a "Not authorized" message.

### 9. Edit `apps/web/src/components/admin-panel.tsx`

- Remove the collapsed `open`/toggle behavior (it is only used on `/admin` now); always render the section content.
- When `statusQuery.data.role !== 'admin'` and embedded on a page, show "Not authorized" instead of `null`.
- Keep `EnrollView`/`StepUpView`/`ManageView` and all admin-token/step-up logic unchanged.

### 10. Edit `apps/web/src/app/layout.tsx`

```
<TRPCProvider>
  <WalletProvider>
    <NavBar />
    {children}
  </WalletProvider>
</TRPCProvider>
```

### 11. Delete `apps/web/src/components/wallet-shell.tsx`

Its content is fully distributed (AuthFlow, HomeDashboard, provider, pages). Update the import in `page.tsx` accordingly.

### 12. Update `ARCHITECTURE.md`

Add a short UI-structure section listing the routes (`/`, `/buy`, `/send`, `/admin`) and note that shared signing/session state lives in a `WalletProvider` context (per AGENTS.md workflow: update the doc in the same change).

## Out of scope

- Any change to tRPC routers, Drizzle schema, or server logic.
- PWA/service worker changes: serwist precaches App Router pages automatically; the new routes need no config (verify once in dev).
- Moving the auth flow off `/`.

## Risks / edge cases

- **Secret in memory**: the decrypted key lives only in the provider; a fresh page load or logout clears it, and the next payment re-prompts for the password — same behavior as today.
- **Cross-page state**: `balanceQuery`/`networkConfigQuery` live in the provider so `/buy` and `/send` can trigger `refetchBalances()` and the home page shows fresh numbers on return.
- **Network config dedupe**: AuthFlow's trustline query and the provider's query share the same key but are never enabled simultaneously.
- **Client-only guard**: `/buy`, `/send`, `/admin` check `session` client-side (session is localStorage-only); no middleware needed.
- **Hydration**: `page.tsx`/NavBar become client components that read `localStorage` on the client; initial render is server-safe (same pattern `WalletShell` already used).

## Validation

Run from repo root:
1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test` (server-side suites are unaffected; they do not touch UI components)
4. `pnpm build` then `pnpm dev` — manually verify: signup/login flow on `/`, hub buttons and menu on all four routes, buy-coffee payment with password prompt, send-TAK self-send rejection, admin step-up, logout, and back-button behavior between pages.
