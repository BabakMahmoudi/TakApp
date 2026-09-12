# BlackJack Game Plan

## Goal

Add a **BlackJack** casino game to the existing games subsystem (`spin`/`tap`/`clock`) with
attractive card faces and deal/flip animations, following the same **fixed fee + fixed prize**
economics as the current games: the player pays `paidPlayFee` TAK to the casino account up front and
wins a single fixed `prizeTak` for beating the dealer.

## Resolved decisions

- **Money model**: fixed `paidPlayFee` + fixed `prizeTak` (reuses the casino account, `game_plays`,
  and the existing `submitTakTransfer` payout path). No variable bets, no bankroll sizing beyond the
  current "casino must cover the prize" check.
- **Cards**: open-source React card component — primary `react-playing-cards` (CSS-drawn faces from
  the classic "CSS Playing Cards" project; self-contained, no image assets, offline-safe). Fallback:
  `react-playing-card`, or a self-authored SVG card set if peer-deps reject React 19.
- **Rules**: hit/stand only; dealer stands on soft 17; single 6-deck shoe reshuffled per hand; a
  tie/push is a **loss** (house edge, no refund transfer); natural blackjack is a flat win (no 3:2).
  Double/split/insurance are out of scope because they require extra bets, which the fixed-fee model
  cannot express.
- **Fairness**: server-authoritative hidden deck (consistent with the existing games). Provably-fair
  commitment schemes are out of scope for v1.

## Key architectural change

The existing games are one-shot: `startGame` stores server-generated `params`, the client animates,
then `finishGame` settles. BlackJack is **multi-turn and stateful**, so it needs:

1. A **server-only `hidden_state`** column on `game_plays` holding the shuffled deck, the player
   hand, and the dealer hand (including the face-down hole card). This column is read only by server
   code and is **never** returned by any tRPC procedure or `getGameHistory`.
2. A new per-action mutation `games.blackjack.action` (`hit` / `stand`) that advances the server-side
   state machine, persists it, and returns only the **visible** state (player cards, dealer up-card,
   totals, phase). On resolution it pays the prize (win) or marks the play lost (bust/loss/push).

`game_plays.params` for blackjack stores only the latest **visible** state (used for resume), while
`game_plays.hidden_state` stores the private deck + hole card.

## Data flow

1. `games.start` (`blackjack`): records the fee payment (existing idempotent logic), builds + shuffles
   the shoe, deals 2 cards to the player and 2 to the dealer (second dealer card = hole card), writes
   `hidden_state`, writes the initial visible deal to `params`, and returns the visible state with
   `phase: 'player_turn'`.
2. Client `BlackjackTable` renders the visible state and offers **Hit** / **Stand**.
3. `games.blackjack.action({ playId, action })`:
   - `hit`: draw top card into the player hand. If bust (`>21`) → resolve loss (status `lost`, no
     payout). Otherwise persist and return the updated visible state.
   - `stand`: reveal the hole card, dealer draws to `>= 17` (soft 17), then compare:
     dealer bust / dealer lower → **win** (pay `prizeTak`, status `won`); dealer higher / tie(push) /
     player already bust → **loss** (status `lost`). Return the settled result.
4. `GameShell` shows the result screen via the shared result/`FinishResult` path and refetches
   balances (reusing the existing win/lose result UI).

Natural blackjack (initial 21) is **not** auto-resolved at deal; it flows through the normal stand
path (flat prize either way). If auto-stand on naturals is later desired, add a check in `startGame`.

## Ordered tasks

1. **Schema** — add `hiddenState: text('hidden_state')` to `gamePlays` in
   `packages/shared/src/db/schema.ts`; regenerate migration (`pnpm db:generate`) →
   `ALTER TABLE game_plays ADD COLUMN hidden_state text;` + snapshot. Update the `GamePlay` type.
2. **Server logic** — new `apps/web/src/server/games/blackjack.ts` with pure, testable helpers:
   `Card`/`Suit`/`Rank` types, `newShoe(decks)` (Fisher-Yates via `crypto.getRandomValues`),
   `handValue()` (ace 1/11), `isBlackjack()`, `deal()`, `applyHit()`, `applyStand()` (dealer play),
   and `blackjackOutcome()` returning `'win' | 'loss'` (push ⇒ loss).
3. **Game definitions** — in `apps/web/src/lib/games.ts`: add `'blackjack'` to `GAME_KEYS`/`GameKey`;
   add `BlackjackSettings = CommonSettings` (no extra fields), `BlackjackCard`,
   `BlackjackVisibleState`, and `BlackjackParams`; add `BlackjackParams` to the `GameParams` union;
   add `defaultSettings.blackjack` (common defaults, `completionWindowSeconds: 180`); add
   `settingsFields.blackjack` = the five common fields; add the `GAMES` descriptor entry with
   `titleKey`/`descriptionKey` for `games.blackjack.*`.
4. **Service** — in `apps/web/src/server/games/service.ts`:
   - Extend `startGame` with a blackjack branch that builds the shoe, deals, writes `hidden_state`
     and visible `params`, and returns the visible state.
   - Extract the win-payout block currently inline in `finishGame` into a reusable helper
     (e.g. `payOutWin(db, env, play, userId, prize, performance, score)`) so both `finishGame` and the
     blackjack resolver share it.
   - Add `blackjackAction(db, env, { userId, playId, action })` implementing the hit/stand state
     machine, expiry handling (abandon past the completion window), and payout on win.
   - Guard `finishGame` against `gameKey === 'blackjack'` (must use `blackjack.action`).
   - Ensure `getGameHistory` and all responses **never** surface `hidden_state`.
5. **tRPC router** — in `apps/web/src/server/trpc/routers/games.ts`: add a nested
   `blackjack: router({ action: protectedProcedure.input(z.object({ playId: z.number().int().positive(),
   action: z.enum(['hit','stand']) })).mutation(...) })` (client path `trpc.games.blackjack.action`).
6. **Client component** — new `apps/web/src/components/games/blackjack-table.tsx`:
   - Wrap the chosen card lib in a local `PlayingCard` helper mapping `{ suit, rank }` and a
     face-down card-back (own div/SVG, since the lib may lack face-down).
   - Dealer area (hole card face-down until resolved), player area, running totals, and Hit/Stand
     buttons (visible only in `player_turn`).
   - CSS transition/keyframe animations for dealing (translate + rotate + fade) and hole-card flip,
     matching the existing `spin-wheel.tsx` animation style.
   - Call `trpc.games.blackjack.action`; on `settled` invoke `onSettled(result)`.
7. **Shell wiring** — in `apps/web/src/components/games/game-shell.tsx`: render `BlackjackTable` for
   `active.params.game === 'blackjack'`, add a `handleSettled(result)` path that reuses the result
   screen + `refetchBalances()`/`utils.games.list.invalidate()`. Confirm `resumePending` works via
   `history` (blackjack `params` already holds the latest visible state).
8. **i18n** — add `games.blackjack.*` strings to `en.ts` and `fa.ts` (title, description, hit, stand,
   dealer, player, totals, blackjack/bust/push labels, result wording).
9. **Admin** — verify `listGamesForAdmin`/`listGames` auto-register `blackjack` from `GAME_KEYS` and
   that the settings form renders the five common fields (no new admin code expected).
10. **Tests** — new `apps/web/test/blackjack.test.ts` plus additions to `games.test.ts`:
    - `handValue` ace handling, `isBlackjack`, `blackjackOutcome` (win/loss/push ⇒ loss/dealer bust).
    - `startGame` blackjack: deals 2+2, writes `hidden_state`, returns visible state **without** the
      hole card or deck.
    - `blackjackAction`: hit draws + persists; hit to bust ⇒ lost (no payout); stand ⇒ win pays
      `prizeTak` (mocked `submitTakTransfer`); push ⇒ lost (no payout); expiry ⇒ abandoned.
    - Hidden-state leak: assert `getGameHistory`, `games.start`, and `games.blackjack.action`
      responses never contain `hidden_state`, the deck, or the face-down hole card.
11. **Validation** — `pnpm typecheck`, `pnpm lint`, `pnpm test`; manual dev pass with `pnpm build`
    then `pnpm dev` (games live under `/games`), exercising deal/hit/bust/stand/win/push and a
    mid-hand reload resume.

## Risks & mitigations

- **React 19 peer-dependency incompatibility** of `react-playing-cards`: resolve with a
  `pnpm.overrides` entry for `react`/`react-dom` in `apps/web/package.json`, or fall back to
  `react-playing-card` / self-authored SVG. Verify at install time (`pnpm install`).
- **Hidden-state leak** (cheating vector): enforced by always returning explicit sanitized objects and
  covered by a dedicated leak test.
- **Naturals resolution**: deferred to the stand path for simplicity; flat prize is unchanged.

## Out of scope

- Double-down, split, insurance, variable wagering, provably-fair commitment schemes.
- Push = refund fee (would add a second casino transfer).
- Enforcing the existing-but-unused `maxPaidPlaysPerDay` setting (pre-existing gap, not introduced here).
