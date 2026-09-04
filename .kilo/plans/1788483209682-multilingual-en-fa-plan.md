# Multilingual support: English + Persian (default Persian, switch on Profile page)

## Context

The PWA is currently English-only. Every UI string is hardcoded across ~10 client-rendered files (`nav-bar`, `auth-flow`, `home-dashboard`, `wallet-provider` password modal, `admin-panel`, and the `page.tsx` files for `/`, `/buy`, `/send`, `/tak`, `/wallet`, `/profile`, `/admin`). `app/layout.tsx` renders `<html lang="en">` with no `dir` attribute.

Requirement: support English and Persian, default Persian, user changeable from a settings surface. Persian is RTL, so language support must also flip layout direction.

## Decisions (confirmed with user)

1. **Settings surface**: reuse the existing `/profile` page — add a "Language" section there. No new route or nav entry.
2. **Mechanism**: lightweight custom i18n — a React context + typed `en`/`fa` dictionaries + a `t()` function. No new dependency (no `next-intl`).
3. **Persistence**: device-local `localStorage` (works pre-login and offline, no DB migration). Default `fa` when unset.
4. **Scope**: web PWA only. The Telegram bot is LLM-driven (already answers in the user's language); its fixed strings are out of scope.

## Design

- `type Locale = 'en' | 'fa'`; `DEFAULT_LOCALE = 'fa'`; `SUPPORTED_LOCALES = ['en', 'fa']`.
- Dictionaries are flat keyed objects; `en` is the source of truth and `fa` mirrors its keys. `Messages = typeof en` so every key is type-checked in both languages.
- `t(key)` returns the localized string; key type is `keyof Messages`.
- Provider applies `document.documentElement.lang` and `dir` (`rtl` for `fa`, `ltr` for `en`) in a layout effect and persists changes to `localStorage`.

## Implementation steps

### 1. i18n infra — `apps/web/src/lib/i18n/`

- `locale.ts` — `Locale` type, `DEFAULT_LOCALE`, `SUPPORTED_LOCALES`, and `isLocale(value: unknown): value is Locale` guard (validates stored values, falls back to `fa`).
- `messages/en.ts` — the English dictionary (flat keys, e.g. `nav.home`, `auth.login`, `errors.copyFailed`).
- `messages/fa.ts` — the Persian dictionary with the same keys.
- `messages/index.ts` — `export type Messages = typeof en;` and `export const messages: Record<Locale, Messages> = { en, fa };`.
- `provider.tsx` — `'use client'` `I18nProvider`:
  - State initialized from `getLocale()` (see step 2).
  - `useLayoutEffect` sets `document.documentElement.lang = locale` and `dir = locale === 'fa' ? 'rtl' : 'ltr'`.
  - `setLocale(locale)` updates state + `saveLocale(locale)`.
  - Exposes `{ locale, setLocale, t }` via `I18nContext`.
- `index.ts` — re-export + `useI18n()` hook (throws if used outside provider).

### 2. Storage — `apps/web/src/lib/storage.ts`

Add `LOCALE_KEY = 'takapp.locale'` and:
- `getLocale(): Locale` — reads `localStorage`, returns `isLocale(parsed) ? parsed : DEFAULT_LOCALE`.
- `saveLocale(locale: Locale): void` — writes the key (no-op when `localStorage` undefined).

### 3. Wire the provider — `apps/web/src/app/layout.tsx`

- Change `<html lang="en">` to `<html lang="fa" dir="rtl" suppressHydrationWarning>` (server default matches the Persian default; client corrects to `en`/`ltr` when stored).
- Wrap children with `<I18nProvider>` inside `<body>` (around or inside the existing providers). Keep `metadata`/`viewport` unchanged (brand title stays "TakApp").

### 4. Replace hardcoded strings with `t()`

In each file import `useI18n` and replace literals (copy is the Persian translation of the existing text):
- `components/nav-bar.tsx` — link labels, "Log out", `aria-label="Menu"`.
- `components/auth-flow.tsx` — welcome/signup/mnemonic/login headings, buttons, placeholders, and client-generated errors (`'Failed to generate a valid mnemonic'`, `'No wallet found on this device'`).
- `components/home-dashboard.tsx` — headings, copy button, nav buttons, `'Could not copy your address'`.
- `components/admin-panel.tsx` — all labels/buttons/placeholders/errors in Enroll/StepUp/Manage/Shops/Users views.
- `lib/wallet-provider.tsx` — the password-prompt modal strings ("Enter your password…", "Sign", "Cancel", placeholder).
- `app/profile/page.tsx` — headings, Save/Saved, "Please log in", "Go to login".
- `app/buy/page.tsx`, `app/send/page.tsx`, `app/tak/page.tsx`, `app/wallet/page.tsx`, `app/admin/page.tsx` — page strings, "Please log in", "Go to login", placeholders, empty states, client-generated errors (`'This shop has no payment account yet'`, `'Search and select a recipient first'`, `'Cannot send TAK to yourself'`, `'Amount must be greater than zero'`).

### 5. Language selector on `/profile`

Add a "Language" `<section>` to `app/profile/page.tsx` (visible whether or not logged in is fine; keep the existing session guard):
- Two buttons/segmented control for `English` and `فارسی`, driven by `useI18n().locale` / `setLocale`.
- Persist via `setLocale` (already saves to `localStorage`).

### 6. RTL correctness — logical CSS utilities

Audit and swap physical direction utilities for logical ones so Persian RTL renders correctly (Tailwind v4 supports these):
- `text-left` → `text-start` (in `nav-bar.tsx`, `send/page.tsx`, `admin-panel.tsx`).
- `right-6` (nav dropdown) → `end-6`; any `left-*` → `start-*`, and `mx/px/pl/pr/ml/mr` used for direction → `ms/me/ps/pe` where they encode direction.
- Keep `flex`, `justify-between`, `items-*`, `gap-*` as-is (direction-agnostic).

### 7. Amount/number formatting (display-only)

Add a small helper (e.g. in `lib/i18n/format.ts`): `formatAmount(locale, value)` using `Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', { maximumFractionDigits: 7 })` for balance/amount display (Persian digits for `fa`). Apply to balance displays in `home-dashboard.tsx` and `wallet/page.tsx`. Never change the underlying stroop strings; inputs keep raw Latin numeric input.

### 8. Tests — `apps/web/src/**/*.test.ts` (Vitest)

- `locale.ts` — `isLocale` accepts `'en'`/`'fa'`, rejects others; `getLocale` default is `'fa'`; invalid stored value falls back to `fa`.
- Dictionaries — `Object.keys(en).sort()` equals `Object.keys(fa).sort()` (guards missing/mismatched keys).
- Optional render test: `I18nProvider` sets `document.documentElement.dir`/`lang` on mount and on `setLocale`.

### 9. Update `ARCHITECTURE.md`

Note in UI Structure: the app supports `en`/`fa` (default `fa`), localized via a lightweight `I18nProvider` + typed dictionaries, switched on the Profile page and persisted in `localStorage`; `<html>` carries `lang`/`dir` (RTL for Persian).

## Out of scope

- Server-originated tRPC error messages (44 English `TRPCError`/`Error` messages across `auth`, `payments`, `admin`, `trpc.ts`) remain English for v1. Client-generated errors are localized. (Optional follow-up: map common `TRPCError.code`s to localized messages in a `localizeTrpcError` helper.)
- `next-intl`, routing-based locale URLs, server-side locale detection, and the Telegram bot's fixed strings.
- Persian webfont bundling (system fonts render Persian acceptably; optional Vazirmatn later).
- Localized `metadata` description / PWA manifest (brand name stays "TakApp").
- Database changes.

## Risks / edge cases

- **RTL layout**: physical utilities must be fully swapped or Persian pages will look mirrored-but-broken (misaligned dropdown, left-aligned text). Audit every `text-left`/`right-*`/`left-*` in the listed files.
- **Hydration flash**: default server render is `fa`/`rtl`; a stored `en` flips to `ltr` in a layout effect — acceptable one-frame shift, suppressed via `suppressHydrationWarning`.
- **Dictionary drift**: en/fa must stay key-identical; the key-equality unit test enforces this at CI time.
- **Amount formatting**: localize only for display; never feed `Intl` output back into stroop math or inputs.
- **Offline**: localStorage persistence keeps the locale available offline (PWA requirement intact).

## Validation

From the repo root:

1. `pnpm typecheck`, `pnpm lint`, `pnpm test`.
2. `pnpm build`, then `pnpm dev` and manually verify:
   - First load (fresh browser/no stored locale) renders Persian with `dir="rtl"`.
   - `/profile` shows the Language control; switching to English flips all copy and `dir="ltr"`; switching back to Persian flips to RTL.
   - Reload keeps the chosen language (localStorage).
   - Logged-out welcome/signup/login screens are localized in both languages.
   - Balance amounts render with localized digits in Persian and Latin digits in English.
   - Password-prompt modal and admin panel strings localize.
