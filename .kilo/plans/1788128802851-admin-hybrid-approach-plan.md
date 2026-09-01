# Admin via Hybrid Approach: role on `users` + TOTP step-up + admin-scoped token

## Goal

Let a designated bootstrap admin (env `ADMIN_PUBLIC_KEY`) manage coffee shops through the PWA. Admins are regular `users` (same SEP-10 login) whose account carries a `role`; privileged actions additionally require a TOTP step-up that mints a short-lived, separately-signed admin token. This implements the design agreed in conversation:

- One identity table: `users.role` (`'user' | 'admin'`).
- Bootstrap: first admin promoted implicitly at login when `stellarPublicKey === ADMIN_PUBLIC_KEY`.
- 2FA: TOTP enrollment + `admin.stepUp` issuing an admin token (`typ: 'admin'`, `ADMIN_JWT_SECRET`, 15 min TTL).
- Enforcement: new `adminProcedure` tRPC middleware; role + token type checked server-side per request.
- Admin purpose: coffee-shop CRUD (create/update/disable/list, set owner), plus promote/demote of users.
- Audit log for every privileged mutation; rate-limited step-up.

## Design decisions (finalized)

| Decision | Choice |
| --- | --- |
| Role model | `users.role` column, `'user' | 'admin'`, default `'user'`. Owner stays derived from `coffee_shops.owner_user_id` (existing), not a role value. |
| Bootstrap | `auth.login` promotes the account whose public key equals `ADMIN_PUBLIC_KEY` on every successful login. `adminProcedure` also accepts the bootstrap key directly so a fresh DB works before the first login. |
| TOTP enrollment | 2-step: `enrollTotp` returns a generated base32 secret + otpauth URI (not stored); `confirmTotp({ code, secret })` verifies a code then stores the **encrypted** secret. Client-generated secret is acceptable (it is the user's own account). |
| Step-up | `stepUp({ code })` verifies TOTP (window 1) and mints the admin JWT. Rate-limited to 5 failures / 15 min lockout via D1. |
| Admin token | Stateless JWT: `typ: 'admin'`, `sub = user.id`, `jti = random`, TTL 900 s, signed with `ADMIN_JWT_SECRET`. Not persisted; revocation is instant because `adminProcedure` reloads the user and re-checks `role` each call. |
| Token separation | `protectedProcedure` requires `typ === 'user'`; admin token uses a different secret, so cross-use is impossible even if the typ check regresses. |
| Client transport | Admin token sent in `x-admin-token` header; user token stays in `Authorization`. |
| Rate limiting | New `admin_step_up_attempts` table (unique per user) with failure counter + lockout timestamp. |
| Audit | New `admin_audit_log` table; `logAdminAction` helper called by every admin mutation. |

## Schema changes — `packages/shared/src/db/schema.ts`

Add to `users`:
```ts
role: text('role').notNull().default('user'),
totpSecret: text('totp_secret'), // encrypted base32 secret; set only on enrollment
```

New tables:
```ts
export const adminAuditLog = sqliteTable('admin_audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  action: text('action').notNull(),
  target: text('target'), // e.g. coffee shop id or public key
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const adminStepUpAttempts = sqliteTable('admin_step_up_attempts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().unique().references(() => users.id),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: integer('locked_until', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
```

Then run `pnpm db:generate` and `pnpm db:migrate` (new migration `0001_*`).

## Env changes

`apps/web/src/server/trpc/env.ts` `WorkerEnv` additions:
```ts
ADMIN_PUBLIC_KEY: string;
ADMIN_JWT_SECRET: string;
ADMIN_TOTP_ENC_KEY: string; // 32 bytes, AES-256-GCM key for totpSecret at rest
```

`apps/web/.dev.vars.example`:
```ini
ADMIN_PUBLIC_KEY=G-REPLACE-WITH-FIRST-ADMIN-PUBLIC-KEY
ADMIN_JWT_SECRET=change-me-to-another-long-random-string-at-least-32-chars
ADMIN_TOTP_ENC_KEY=change-me-to-a-32-byte-key-for-totp-encryption
```

`apps/web/wrangler.toml` `[vars]`: `ADMIN_PUBLIC_KEY` (public, not a secret). In production `ADMIN_JWT_SECRET` and `ADMIN_TOTP_ENC_KEY` go to `wrangler secrets`, not `[vars]`.

## Server implementation

New folder `apps/web/src/server/admin/`:

1. **`totp-enc.ts`** — AES-256-GCM encrypt/decrypt of the TOTP secret using Web Crypto (`crypto.subtle`, native on Workers). Format `base64(iv):base64(ciphertext)`. Import key from `TextEncoder` of `ADMIN_TOTP_ENC_KEY`. Throw if key is missing/empty (fail closed).

2. **`guards.ts`** — pure, testable predicates:
   - `isBootstrapAdmin(publicKey: string, envAdminKey: string): boolean`
   - `isAdminUser(user: User, envAdminKey: string): boolean` (role === 'admin' OR bootstrap key)
   - `nextThrottleState(current: { failedAttempts: number; lockedUntil: Date | null }, now: Date): { failedAttempts: number; lockedUntil: Date | null }` — increments; at 5 sets `lockedUntil = now + 15 min` and resets counter; if already locked, stays locked.
   - `isLocked(lockedUntil: Date | null, now: Date): boolean`

3. **`totp.ts`** — `verifyTotpCode(secret: string, code: string): boolean` using `verifySync({ secret, token: code.replace(/\s+/g, ''), window: 1 })` from `otplib` (window 1 tolerates clock drift; the rate limit bounds brute-force).

4. **`audit.ts`** — `logAdminAction(db, adminId, action, target)` inserting into `admin_audit_log`.

### Token issuance — `apps/web/src/server/stellar/session-token.ts`

- Add `typ: 'user'` to the existing user JWT.
- Add `issueAdminToken({ secret, userId, jti, ttlSeconds = 900 })` → `SignJWT({ iss: 'takapp-admin', typ: 'admin', sub: String(userId), jti })`, `alg HS256`, signed with `ADMIN_JWT_SECRET`.

### Middleware — `apps/web/src/server/trpc/trpc.ts`

- `protectedProcedure`: after `jwtVerify` with `JWT_SECRET`, require `payload.typ === 'user'`.
- New `adminProcedure = publicProcedure.use(...)`:
  - Read `x-admin-token` header (raw JWT, no Bearer prefix).
  - `jwtVerify` with `ADMIN_JWT_SECRET`; require `payload.typ === 'admin'` and `payload.sub` present; `UNAUTHORIZED` otherwise.
  - Load `users` by `id = Number(payload.sub)`; require user exists and `isAdminUser(user, env.ADMIN_PUBLIC_KEY)`; else `FORBIDDEN`.
  - `next({ ctx: { ...ctx, admin: user } })`.
- New `export interface AdminContext extends TrpcContext { admin: User }`.

### Bootstrap — `apps/web/src/server/trpc/routers/auth.ts`

In `login`, after `verifyChallengeXdr` succeeds and before issuing the user token:
```ts
if (isBootstrapAdmin(user.stellarPublicKey, ctx.env.ADMIN_PUBLIC_KEY) && user.role !== 'admin') {
  await ctx.db.update(users).set({ role: 'admin' }).where(eq(users.id, user.id));
}
```

### Admin router — `apps/web/src/server/trpc/routers/admin.ts`

Register in `apps/web/src/server/trpc/router.ts` as `admin: adminRouter`.

Procedures:

- `status` — `protectedProcedure` → `{ role: user.role, totpEnrolled: user.totpSecret != null }`.
- `enrollTotp` — `protectedProcedure`; guard `isAdminUser` else `FORBIDDEN`; if `totpSecret` set → `CONFLICT`. Generate secret via `totpProvider.issue()`; return `{ secret, otpauthUri: authenticator.keyuri(email ?? publicKey, 'TakApp', secret) }`. Does not persist.
- `confirmTotp` — `protectedProcedure`, input `{ code: string, secret: string }`; same guard + `CONFLICT` if already enrolled; `verifyTotpCode(secret, code)` else `UNAUTHORIZED`; on success store `encryptTotpSecret(secret, env.ADMIN_TOTP_ENC_KEY)`; audit `totp.enrolled`.
- `stepUp` — `protectedProcedure`, input `{ code: string }`; guard `isAdminUser`; if `totpSecret` null → `PRECONDITION_FAILED` ('TOTP not enrolled'); if throttle locked → `UNAUTHORIZED`; decrypt secret, `verifyTotpCode`; on failure record failed attempt (throttle) → `UNAUTHORIZED`; on success reset throttle, audit `admin.login`, mint `issueAdminToken`, return `{ token }`.
- `promote` — `adminProcedure`, input `{ publicKey: stellarAccountIdSchema }`; target user must exist (`NOT_FOUND`); already admin → `CONFLICT`; set `role: 'admin'`; audit `promote`.
- `demote` — `adminProcedure`, input `{ publicKey }`; target must exist and be admin; self-demotion → `FORBIDDEN`; set `role: 'user'`; audit `demote`.
- `listAdmins` — `adminProcedure` → `[{ id, stellarPublicKey, email, displayName }]` where `role === 'admin'`.
- `listShops` — `adminProcedure` → all shops incl. inactive, with owner public key.
- `createShop` — `adminProcedure`, input `{ name: string(1..120), address?: string(..240), ownerPublicKey?: G-address }`; if `ownerPublicKey` given, resolve to a registered user (`NOT_FOUND`); insert; audit `shop.create`.
- `updateShop` — `adminProcedure`, input `{ id, name?, address?, isActive?, ownerPublicKey? }`; resolve owner like create (empty string clears to null); update; audit `shop.update`.
- `disableShop` — `adminProcedure`, input `{ id }`; set `isActive = false`; audit `shop.disable`.

### Public shops list — `apps/web/src/server/trpc/routers/shops.ts`

Replace the placeholder `list` with a `publicProcedure` returning active shops: `{ shops: [{ id, name, address }] }`. The bot reads D1 directly (`apps/bot/src/db.ts` already filters `isActive`), so it is unaffected.

## Client (minimal admin UI)

1. **`apps/web/src/lib/storage.ts`** — add `ADMIN_TOKEN_KEY = 'takapp.session.adminToken'`; `saveAdminToken`, `getAdminToken`, `clearAdminToken` alongside the existing session helpers.
2. **`apps/web/src/lib/trpc/headers.ts`** — include `'x-admin-token': getAdminToken()` when present.
3. **New `apps/web/src/components/admin-panel.tsx`** ('use client'):
   - In the balance phase (`wallet-shell.tsx`), query `admin.status` (enabled when logged in) and, when `role === 'admin'`, render an "Admin" button.
   - Panel states:
     - **Enroll** (not enrolled): show `otpauthUri` + `secret`; input 6-digit code → `confirmTotp`.
     - **Step-up** (enrolled, no admin token): input 6-digit code → `stepUp` → `saveAdminToken`.
     - **Manage** (admin token present): shops tab (list, create form with name/address/owner public key, disable button); users tab (list admins, promote by public key, demote). On `UNAUTHORIZED`/`FORBIDDEN` from an admin call, `clearAdminToken` and fall back to step-up.
4. Keep all role decisions server-side; the UI only gates visibility.

## Docs

- `ARCHITECTURE.md`: update `Authentication & Key Management` (bootstrap + step-up), `Data Model` (`role`, `totp_secret`, `admin_audit_log`, `admin_step_up_attempts`), `Admin / owner` flow, and `Security Model` (admin token separation, step-up throttle). Per AGENTS.md workflow, the doc must be updated in the same change.
- `apps/web/.dev.vars.example` (see Env section).

## Tests (Vitest) — failure paths required by AGENTS.md

- `apps/web/test/totp-enc.test.ts` — encrypt/decrypt round-trip; tampered ciphertext throws.
- `apps/web/test/admin-token.test.ts` — `issueAdminToken` verifies with `ADMIN_JWT_SECRET`, has `typ: 'admin'`; verification with a different secret fails; user token has `typ: 'user'`.
- `apps/web/test/admin.test.ts` — pure-helper coverage:
  - `isBootstrapAdmin` / `isAdminUser` true/false cases.
  - Throttle: increments, locks at 5, honors lock, resets on success.
  - `verifyTotpCode`: valid code from `authenticator.generate(secret)` accepted; wrong code rejected.
  - Promote/demote guards: unknown target (`NOT_FOUND`), already-admin (`CONFLICT`), self-demote (`FORBIDDEN`).
- No D1 harness exists yet; keep middleware/router integration tests out of scope, but keep the pure logic testable.

## Validation

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm db:generate   # verify migration 0001 diff is sane
pnpm db:migrate
pnpm build         # OpenNext worker must build; run before pnpm dev after server changes
```

Manual smoke: sign up the bootstrap key's account, log in (role auto-promoted), enroll TOTP, step up, create/disable a shop via the admin panel, verify the bot's `shops` reply and public `shops.list` only show active shops.

## Risks / notes

- `ADMIN_TOTP_ENC_KEY` must be exactly 32 bytes for AES-256-GCM; fail closed if absent.
- Stateless admin token: demotion revokes instantly (role re-checked per request); logout is client-side token discard + 15-min TTL.
- TOTP window 1 + throttle bounds brute-force; lockout is 15 min per user.
- Env bootstrap key is a seed, not a dependency: existing admins persist in D1 even if `ADMIN_PUBLIC_KEY` is later removed.

## Out of scope

- Admin panel styling/UX beyond minimal function.
- Owner self-service UI (owners manage own shops) — later plan.
- Telegram bot admin surfaces.
- Email/SMS verification delivery (unchanged stubs).
