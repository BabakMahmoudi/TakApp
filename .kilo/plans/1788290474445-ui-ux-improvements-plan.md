# UI refinements: menu, merged home panel, Get TAK / Profile pages, admin button fix

## Context

Follow-up to the page-routing refactor (`.kilo/plans/1788289982764-page-routing-plan.md`). The user tested the routed app and reported 5 issues: (1) prefer a menu icon, (2) merge the address and balances panels, (3) move Free TAK to its own page for future TAK-gaining methods, (4) move Profile to its own page, (5) the Admin Panel button does not show up when logged in as admin.

Root-cause analysis for #5 (confirmed with user): `apps/web/.dev.vars` sets `ADMIN_PUBLIC_KEY=GCGXCQE7UE5RLKAN2SLJLWAGXWE4MR3VUUUOHBVWJOOA2HKUQTJGKV5P`. An account is admin only if its DB `role` is `admin` **or** its public key equals that key (`isAdminUser`). The NavBar/Home/Admin UI all hide whenever `admin.status` returns `role !== 'admin'` or the query errors. The bootstrap key can report non-admin while the DB row still has `role: 'user'`, and a silent query error hides the cause entirely.

## Decisions (confirmed with user)

1. **Menu**: a menu (hamburger) icon in the header opens a **dropdown panel** under it (not a drawer). Closes on navigation, outside click, and Escape. Contains Home, Buy Coffee, Send TAK, Get TAK, Profile, Admin Panel (if admin), and Log out.
2. **Home**: merge "My address" and "Balances" into a single panel.
3. **Get TAK**: new route `/tak`, structured so future "ways to get TAK" can be appended. v1 ships only the free welcome gift.
4. **Profile**: new route `/profile` with the display-name editor.
5. **Admin button**: robust fix — the server reports admin using the same rule admin procedures use (`isAdminUser`: `role==='admin'` OR bootstrap key match), the client exposes one shared `isAdmin`/`adminStatusQuery` from the `WalletProvider` consumed by menu/home/admin, and the status query error is logged in the console in dev.

## Implementation steps

### 1. Server: `admin.status` reports effective admin

`apps/web/src/server/trpc/routers/admin.ts` — `status` procedure (currently returns `{ role, totpEnrolled, totpRequired }`):

```ts
status: protectedProcedure.query(async ({ ctx }) => ({
  role: isAdminUser(ctx.user, ctx.env.ADMIN_PUBLIC_KEY) ? 'admin' : ctx.user.role,
  isAdmin: isAdminUser(ctx.user, ctx.env.ADMIN_PUBLIC_KEY),
  totpEnrolled: ctx.user.totpSecret != null,
  totpRequired: isTotpRequired(ctx.env),
})),
```

`isAdminUser` is already imported in this file. The added `isAdmin` field is additive; no server test asserts the old shape (checked).

### 2. Provider: shared admin status + `isAdmin`

`apps/web/src/lib/wallet-provider.tsx`:
- Import `useEffect`; add `type AdminStatusData = inferRouterOutputs<AppRouter>['admin']['status'];`.
- Add `const adminStatusQuery = trpc.admin.status.useQuery(undefined, { enabled: !!session, retry: false });` alongside the other queries.
- Context additions:
  - `adminStatusQuery: UseTRPCQueryResult<AdminStatusData, ApiError>;`
  - `isAdmin: boolean;` computed as `adminStatusQuery.data?.isAdmin === true`.
- Dev logging effect: `useEffect(() => { if (adminStatusQuery.error) console.warn('[admin.status]', adminStatusQuery.error); }, [adminStatusQuery.error]);`

### 3. NavBar: hamburger dropdown menu

Rewrite `apps/web/src/components/nav-bar.tsx`:
- Read `{ session, logout, isAdmin }` from `useWallet()`; remove its own `trpc.admin.status` query. Keep `usePathname()`.
- Header wrapper becomes `relative`; title link left, menu button right (inline SVG hamburger, `aria-label="Menu"`, `aria-expanded`).
- Dropdown panel (`absolute right-0 top-full mt-2 w-48 rounded-xl border border-coffee-700 bg-coffee-950 p-2 shadow`): links Home `/`, Buy Coffee `/buy`, Send TAK `/send`, Get TAK `/tak`, Profile `/profile`, Admin Panel `/admin` (only when `isAdmin`), and a Log out button calling `logout`.
- Active link highlighted when `pathname === link.href` (keep `bg-coffee-600 text-coffee-50` vs `border border-coffee-700 text-coffee-200` styles).
- Close on: link click, document `pointerdown` outside a ref, and Escape key (add/remove listeners in an effect; the `pathname`-change effect closes the menu too).
- Render `null` when `!session`.

### 4. HomeDashboard: merged panel + navigation buttons

`apps/web/src/components/home-dashboard.tsx`:
- Merge the address and balances markup into one `<section>`: address line + copy button, then the balances list below it (reuse existing markup/classes verbatim).
- Remove the Free TAK section, the Profile section, and their logic (`claimGiftMutation`, `meQuery`, `updateProfileMutation`, `statusQuery`, `profileName`/`profileSaved` state, `claimGift`, `saveProfile`).
- Keep `copied` state + `copyPublicKey`; read `{ session, balanceQuery, error, setError, isAdmin }` from `useWallet()`.
- Navigation section: a 2-column grid (`grid grid-cols-2 gap-3`) of buttons linking to Buy Coffee `/buy`, Send TAK `/send`, Get TAK `/tak`, Profile `/profile`, and Admin Panel `/admin` (only when `isAdmin`).
- Keep the final `error` render.

### 5. New page: `/tak` (Get TAK)

Create `apps/web/src/app/tak/page.tsx` (`'use client'`):
- Session guard identical to buy/send (`Please log in` + `Go to login` link).
- Section "Get TAK" rendering a data-driven list of ways to obtain TAK. v1 list:
  - `{ id: 'welcome-gift', title: 'Welcome gift', description: 'Claim a one-time welcome gift of 10 TAK.', ctaLabel: 'Claim 10 free TAK' }`.
- Claim handler = current `claimGift` logic (`trpc.wallet.claimGift` + `refetchBalances`, provider `busy`/`setBusy`/`error`/`setError`). Render each entry with its CTA button (disabled while `busy`, label shows `Claiming…` while busy).
- Later "ways to get TAK" are just additional list entries.

### 6. New page: `/profile`

Create `apps/web/src/app/profile/page.tsx` (`'use client'`):
- Session guard as above.
- Display-name editor copied from the current home panel: `trpc.users.me` for the initial value, `trpc.users.updateProfile`, maxLength 50, Save button with `isPending`/saved state, provider `setError`.
- Show the user's email/phone when available from `meQuery` as read-only context (optional, nice-to-have).

### 7. AdminPanel: consume the shared query

`apps/web/src/components/admin-panel.tsx`:
- Replace the own `trpc.admin.status` query with `const { adminStatusQuery } = useWallet();` (import `useWallet`).
- Gate: `if (!adminStatusQuery.data) return null;` then `if (!adminStatusQuery.data.isAdmin) return <p className="text-sm text-red-400">Not authorized</p>;`.
- Pass `totpRequired={adminStatusQuery.data.totpRequired}` to `StepUpView`.
- Everything else (Enroll/StepUp/Manage views, admin-token logic) unchanged.

### 8. Update `ARCHITECTURE.md`

In the UI Structure section: list the six routes (`/`, `/buy`, `/send`, `/tak`, `/profile`, `/admin`), note the hamburger dropdown menu, the merged home panel, and that admin gating comes from the provider's shared `adminStatusQuery`/`isAdmin` (server-side `isAdminUser` rule).

## Out of scope

- Other tRPC procedures, Drizzle schema, bot, or payment logic.
- PWA/service-worker config: the new static routes are precached automatically by serwist (verify once in dev).
- Adding actual new "ways to get TAK" beyond the welcome gift (structure only).

## Risks / edge cases

- **Menu positioning**: the dropdown is absolutely positioned inside the `max-w-md` header; the header must be `relative`, and outside-click/Escape listeners must be added and removed cleanly to avoid leaks.
- **`admin.status` gating change**: it is now enabled only when `session` exists (the previous AdminPanel copy was unguarded). `/admin` already guards on session before rendering `AdminPanel`, so nothing is lost; provider consumers dedupe onto one query.
- **Admin false-negative**: if the logged-in account is not the bootstrap key and its DB role is still `user`, `isAdmin` is false by design. Before manual validation, confirm the account's public key matches `ADMIN_PUBLIC_KEY` in `apps/web/.dev.vars` (or promote via an existing admin).
- **Hydration**: unchanged pattern (client reads localStorage); same as current code.

## Validation

From the repo root:

1. `pnpm typecheck`, `pnpm lint`, `pnpm test`.
2. `pnpm build`, then `pnpm dev` and manually verify:
   - Menu: hamburger opens the dropdown; closes on navigation, outside click, and Escape; active route highlighted; Log out works; links include Get TAK and Profile.
   - Home: single merged address+balances panel; nav buttons for Buy/Send/Get TAK/Profile, plus Admin when admin.
   - `/tak`: claim 10 free TAK and balances refresh; layout ready for more methods.
   - `/profile`: display name pre-fills from `users.me` and saves.
   - Admin: log in with the account whose public key equals `ADMIN_PUBLIC_KEY`; the Admin link appears in the menu and on home, `/admin` renders the panel (TOTP step-up skipped when `ADMIN_TOTP_REQUIRED=false`), and the console shows no `[admin.status]` error.
