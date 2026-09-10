# Plan: Login-page slogan + "find more" → FAQ agent

## Goal

When a visitor first opens the app (logged out), the login page shows the project
slogan with a **"find more"** button. The button opens the in-app AI agent
(`/agents`) **anonymously**, grounded in a curated digest of `WHITEPAPER.md` +
`WHITEPAPER-FA.md`, and — when opened this way — auto-starts the conversation
with a fixed short intro paragraph about the project.

## Decisions (confirmed)

- Target surface: **in-app agent only** (`apps/agents` → `TakAppAgent`). Telegram bot is out of scope.
- Grounding: **curated digest** (a single compact project-knowledge string) injected into the agent system prompt. The FA whitepaper is a translation of the EN one, so one digest covers both; the model is instructed to answer in the user's language (English or Persian).
- Anonymous use: supported by design; must fix the tRPC header gap (Task 1) for it to actually work.
- Slogan + intro copy: use the drafts below (localized EN + FA).

## Draft copy

Slogan (login page):
- EN: `TAK — the community coffee token: pool together, buy together, everyone drinks better coffee for less.`
- FA: `تک — توکن قهوه‌ی جامعه: روی هم بگذاریم، با هم بخریم، همه قهوه‌ی بهتر را ارزان‌تر بنوشند.`

Button label:
- EN: `Find more`  |  FA: `بیشتر بدانید`

Intro paragraph (agent opening):
- EN: `TAK is a community coffee token on Stellar. Members pool their purchasing power to buy coffee in bulk and pass the savings back as real, per-cup discounts in local coffee shops. Ask me anything about TAK, how it works, or where you can use it.`
- FA: `تک یک توکنِ قهوه‌ی جامعه بر بستر شبکه‌ی استلار است. اعضا قدرت خریدشان را تجمیع می‌کنند تا قهوه را عمده بخرند و صرفه‌جویی را به‌صورت تخفیف واقعی در هر فنجان به خودشان برگردانند. هر سؤالی درباره‌ی تک، نحوه‌ی کارش یا کافه‌های عضو دارید بپرسید.`

## Context / key files

- Login page: `apps/web/src/components/auth-flow.tsx` (renders `TakApp` + `auth.tagline`).
- Agent page: `apps/web/src/app/agents/page.tsx` (lists/creates conversations, streams chat).
- Agent knowledge: `apps/agents/src/prompt.ts` (`buildSystemPrompt`), model/tools in `apps/agents/src/llm/deepseek.ts`, `apps/agents/src/tools/index.ts`.
- Anonymous owner resolution: `apps/web/src/server/agents/owner.ts` (falls back to `x-anonymous-key`), `apps/web/src/server/agents/proxy.ts`, `apps/web/src/server/trpc/routers/agents.ts` (`publicProcedure`).
- i18n: `apps/web/src/lib/i18n/messages/en.ts`, `.../fa.ts`.
- **Gap**: `apps/web/src/lib/trpc/headers.ts` (`authHeaders`) never sends `x-anonymous-key`, so anonymous `agents.create`/`agents.list` fail/return empty.

## Tasks (ordered)

### 1. Fix anonymous tRPC header (linchpin)
- Edit `apps/web/src/lib/trpc/headers.ts`: import `getAnonymousKey` from `../storage`, add
  `const anonymousKey = getAnonymousKey(); if (anonymousKey) headers['x-anonymous-key'] = anonymousKey;`
  to `authHeaders()`. `getAnonymousKey()` returns a UUID (created on first call), so no new state.
- Only the agents router reads this header; all other procedures are JWT-gated and unaffected.

### 2. Curated knowledge digest (agents worker)
- Create `apps/agents/src/knowledge.ts` exporting `TAK_KNOWLEDGE: string`.
- Edit `apps/agents/src/prompt.ts`: import `TAK_KNOWLEDGE` and append it to `buildSystemPrompt`'s
  lines, keeping the existing safety lines ("untrusted", "read-only", "Never invent data",
  "Never mention secret keys") and adding "Answer in the user's language (English or Persian)."
  The contract id continues to come from `takContractId`.
- Digest must cover: abstract/origin (Farahan café, pooled money, Alireza), what TAK is
  (payment token + digital coupon + fair share + unit of account = 20 g coffee), token facts
  (Stellar, SEP-41, 7 decimals, elastic supply, 1% governance-adjustable fee, bean anchor
  `1 TAK = 20 g`), per-cup economics (~30% discount), the mint/burn loop, why Stellar,
  ecosystem (wallet, ordering, get-3-TAK claim, games, Telegram assistant, in-app agent),
  roadmap phases, governance principles, and a one-line risk note ("utility token, not an
  investment").

### 3. Login page slogan + "find more"
- Add i18n keys `auth.slogan` and `auth.findMore` (EN + FA).
- Edit `apps/web/src/components/auth-flow.tsx`: in the top header block (shared across
  welcome/signup/login phases) render `t('auth.slogan')` prominently and a button linking to
  `/agents?intro=1` (use `next/link` `Link`). Keep `auth.tagline` as a secondary line or fold
  it in.

### 4. Auto-intro on `/agents?intro=1`
- Add i18n key `agents.intro` (EN + FA).
- Edit `apps/web/src/app/agents/page.tsx`:
  - In a mount-only `useEffect`, parse `new URLSearchParams(window.location.search)` for `intro`.
  - If present and not yet seeded (guard with a ref), call `createMutation.mutateAsync({ agentId: AGENT_ID })`
    (now works anonymously via Task 1), set `activeId`/`activeMemoryId`, seed
    `messages = [{ role: 'assistant', content: t('agents.intro') }]`, persist via `saveMessages`,
    and `listQuery.refetch()`. On failure, set `error` without blocking manual use.
  - The intro is a fixed client-side greeting bubble (not LLM-generated); the DO is left
    unseeded (acceptable — greeting is presentational).

### 5. Tests
- Extend `apps/agents/test/prompt.test.ts`: assert `buildSystemPrompt(...)` contains digest
  markers (e.g. "community coffee token", "Farahan", "20 g") and still contains the safety lines.
- Existing `apps/web/test/agents.test.ts` already covers anonymous create/list; keep green.
- Optional: unit-test `authHeaders` includes `x-anonymous-key` (needs localStorage mock; skip if no client test harness).

## Failure modes / edge cases

- **Anonymous visitor** opens `/agents?intro=1`: conversation created with `anonymousKey`; balance/history tools refuse politely (`getUserBalance` → "Log in"). No auth, no funds access.
- **Logged-in user** opens `/agents?intro=1`: conversation is created under their `userId` (owner resolution prefers the JWT), intro still shows.
- **`create` fails** (network/DB): intro seeding sets an error message; user can still type to trigger the normal create-on-first-send path.
- **localStorage cleared**: anonymous identity is device-scoped and lost; that is expected and acceptable.
- **Digest drift**: whitepaper edits must be mirrored in `knowledge.ts`; noted as an ongoing maintenance rule.

## Validation

- `pnpm typecheck`, `pnpm lint`, `pnpm test` (web + agents).
- `pnpm build` before local preview (server/agent changes), then run both
  `pnpm --filter @takapp/agents dev` and `pnpm dev`; confirm the web→`AGENTS` service binding resolves.
- Manual: open `/` logged out → slogan + "Find more" visible → click → `/agents?intro=1` shows the intro paragraph → ask "What is TAK?" for a grounded answer → ask "show my balance" to confirm a polite anonymous refusal.

## Out of scope

- Telegram bot FAQ grounding (read-only balance/shops/history unchanged).
- Persian-whitepaper-specific content split (one digest + "answer in the user's language" suffices).
