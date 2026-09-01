# Revert TAK to a classic Stellar asset (code "TAK" + issuer)

## Problem

A prior plan (`.kilo/plans/1788296679642-sep41-tak-migration.md`) migrated TAK **from** a
classic asset **to** a SEP-41 Soroban contract token, producing the current broken state:
balance is read via Soroban RPC `Contract.balance`, payments use a Soroban
`transfer`/`assembleTransaction`, config carries `TAK_CONTRACT_ID`/`SOROBAN_RPC_URL`, and no
trustline is ever established. The user confirmed TAK is a **classic Stellar asset** (code
`TAK`, defined by an issuer account), as demonstrated by the working reference in
`cafe-bazi/src/services/stellar.ts` (`Asset("TAK", issuer)`, `Operation.payment`,
`Operation.changeTrust`, balance from Horizon `account.balances`).

This plan reverses that migration, minus the gift flow (the welcome-gift was removed in the
SEP-41 migration and stays removed).

## Confirmed decisions

- **Trustline**: established automatically at signup (idempotent `ensureTrustline`), fail-open
  (proceed to login on failure) and self-heal before the first TAK send.
- **Issuer**: reuse cafe-bazi's existing TAK issuer via a new `TAK_ISSUER_PUBLIC_KEY` env var;
  asset code stays the constant `"TAK"`.
- **Amounts**: keep the existing 7-decimal stroop model. Balance is read with
  `stroopsFromLumens(balance.balance)`; payments pass `lumensFromStroops(stroops)` as the
  `Operation.payment` amount. The SEP-41 `decimals` concept and `stroopsFromTokenRaw` are removed.
- **Gift**: stays removed (no server-side TAK issuance).

## Ordered tasks

### A. Config & env — remove Soroban/contract, add issuer

1. `apps/web/src/server/trpc/env.ts`: replace `SOROBAN_RPC_URL: string` and
   `TAK_CONTRACT_ID: string` with `TAK_ISSUER_PUBLIC_KEY: string`.
2. `apps/bot/src/env.ts`: same replacement.
3. `apps/web/wrangler.toml` `[vars]`: remove `SOROBAN_RPC_URL` and `TAK_CONTRACT_ID`; add
   `TAK_ISSUER_PUBLIC_KEY = "<issuer>"`.
4. `apps/bot/wrangler.toml` `[vars]`: same removal/addition.
5. `apps/web/.dev.vars.example` and `apps/bot/.dev.vars.example`: replace the Soroban/contract
   lines with `TAK_ISSUER_PUBLIC_KEY` (comment that it is the cafe-bazi TAK issuer). Also update
   the local `.dev.vars` files (not committed).

### B. Shared money helper

6. `packages/shared/src/money.ts`: remove `stroopsFromTokenRaw` (dead once TAK is classic).
7. `packages/shared/test/money.test.ts`: remove the `stroopsFromTokenRaw` describe/its.

### C. Web server — balance read

8. `apps/web/src/server/stellar/horizon.ts`: rewrite `fetchBalances` to
   `(server: HorizonServer, publicKey: string, takIssuer: string)`:
   - XLM from `asset_type === 'native'` via `stroopsFromLumens(balance.balance)` (unchanged);
   - TAK from `asset_type === 'credit_alphanum4' && asset_code === 'TAK' &&
     asset_issuer === takIssuer` via `stroopsFromLumens(balance.balance)`;
   - drop `Address`, `Contract`, `scValToNative`, `TransactionBuilder`, `SorobanRpc`,
     `SorobanApi`, `stroopsFromTokenRaw`, and the `networkPassphrase` param. Keep `BalanceEntry`
     and `HorizonServer`.
9. `apps/web/src/server/trpc/routers/wallet.ts`:
   - `balance`: remove the `SorobanRpc` construction; call
     `fetchBalances(server, ctx.user.stellarPublicKey, ctx.env.TAK_ISSUER_PUBLIC_KEY)`.
   - `networkConfig`: return `takAsset: { code: 'TAK', issuer: ctx.env.TAK_ISSUER_PUBLIC_KEY }`;
     remove `takToken`, `decimals`, `sorobanRpcUrl`, the `SorobanRpc` import, and `TAK_DECIMALS`.

### D. Client worker & provider — payment + trustline

10. `apps/web/src/workers/messages.ts`:
    - `submit-payment` payload → `{ secretKey; destination; amount; assetIssuer; horizonUrl;
      networkPassphrase }` (drop `contractId`, `amountRaw`, `rpcUrl`; `amount` is the 7-decimal
      string).
    - add `ensure-trustline` payload `{ secretKey; assetIssuer; horizonUrl; networkPassphrase }`.
    - add an `ensure-trustline` response variant, e.g. `{ type: 'trustline'; txHash: string | null }`
      (`null` = trustline already present).
11. `apps/web/src/workers/stellar-worker.ts`:
    - imports: add `Asset`, `Operation`; remove `Address`, `Contract`, `nativeToScVal`,
      `SorobanRpc`, `SorobanApi`, `assembleTransaction` (no Soroban simulation left).
    - rewrite `submit-payment`: `loadAccount` → build
      `Operation.payment({ destination, asset: new Asset('TAK', request.assetIssuer), amount: request.amount })`
      → `TransactionBuilder(account, { fee, networkPassphrase }).addOperation(op).setTimeout(180).build()`
      → `sign(keypair)` → submit XDR to Horizon `/transactions` with the existing idempotent retry.
    - add `ensure-trustline`: `loadAccount`; if the account already has a
      `credit_alphanum4`/`TAK`/`issuer` balance line, respond `{ txHash: null }`; otherwise build
      `Operation.changeTrust({ asset: new Asset('TAK', request.assetIssuer) })`, sign, submit
      (same retry helper), respond with the tx hash.
12. `apps/web/src/workers/stellar-worker-client.ts`: update `SubmitPaymentInput` fields; add
    `ensureTrustline(input): Promise<string | null>` plus its input type; keep `submitPayment`
    returning `txHash`.
13. `apps/web/src/lib/wallet-provider.tsx`: in `submitPayment`, first call
    `worker().ensureTrustline({ secretKey, assetIssuer: config.takAsset.issuer, ... })` (self-heal,
    no-op when present), then `worker().submitPayment({ ..., amount: lumensFromStroops(input.stroops),
    assetIssuer: config.takAsset.issuer })`; drop `contractId`/`rpcUrl`/`amountRaw` wiring.

### E. Signup trustline

14. `apps/web/src/components/auth-flow.tsx`: after `signupMutation.mutateAsync(...)` succeeds and
    before `runLogin(...)`, call `worker().ensureTrustline(...)` using `flowRef.current.secretKey`
    and the issuer from a public `trpc.wallet.networkConfig.useQuery(undefined)` (public, works
    pre-login). Fail-open: on error `beacon(...)` and proceed to login (the account remains usable
    for XLM; TAK trustline self-heals on first send per task 13).

### F. Bot

15. `apps/bot/src/stellar.ts`: rewrite `createBalanceReader.readBalances` to read XLM (native) and
    TAK (`credit_alphanum4`, `asset_code === 'TAK'`, `asset_issuer === env.TAK_ISSUER_PUBLIC_KEY`)
    from Horizon `account.balances` via `stroopsFromLumens`; remove `SorobanRpc`, `Contract`,
    `Address`, `scValToNative`, `TransactionBuilder`, `stroopsFromTokenRaw`, `TAK_DECIMALS`.

### G. Tests

16. `apps/web/test/fetch-balances.test.ts`: rewrite to mock `loadAccount` returning native XLM plus
    a `credit_alphanum4` TAK entry; assert XLM + TAK stroop conversion, and a no-trustline case
    returning only XLM. Remove all Soroban RPC mocks.
17. `apps/web/test/helpers/caller.ts`: replace `SOROBAN_RPC_URL`/`TAK_CONTRACT_ID` with
    `TAK_ISSUER_PUBLIC_KEY`.
18. `apps/bot/test/handler.test.ts`: update `createEnv()` (drop `SOROBAN_RPC_URL`/`TAK_CONTRACT_ID`,
    add `TAK_ISSUER_PUBLIC_KEY`).
19. (Optional) add a unit test for the worker `ensure-trustline`/payment op-building if a worker
    test harness exists; otherwise rely on typecheck + manual smoke.

### H. Docs

20. `ARCHITECTURE.md`: describe TAK as a classic asset (code `TAK` + issuer, read from Horizon
    trustline, transferred with `Operation.payment`, accepted with `changeTrust`); add the signup
    trustline step; remove SEP-41/Soroban RPC references; keep the "gift removed" note.
21. `AGENTS.md`: fix the overview line "TAK (a SEP-41 Soroban contract token, 7 decimals)" and any
    SEP-41/Soroban wording in the constraints.

## Out of scope

- Re-adding the welcome-gift / server TAK issuance flow.
- TAK issuance/distribution (supply comes from the reused cafe-bazi issuer).
- Recipient trustline enforcement: every registered user gets a trustline at signup; a recipient
  that still lacks one surfaces a standard `op_no_trust` payment error.

## Risks

- **Signup retry vs. trustline failure**: mitigated by fail-open (proceed to login) plus self-heal
  in `submitPayment`; avoids the `CONFLICT` trap where the funded account already exists.
- **Placeholder issuer**: `GAAAA…WHF` is not a real funded issuer. `TAK_ISSUER_PUBLIC_KEY` must be
  set to the actual cafe-bazi testnet issuer for any live smoke test.
- **Recipient without trustline** → `op_no_trust`; acceptable for v1 (all app users are funded +
  trustlined at signup).

## Validation

- `pnpm typecheck`, `pnpm lint`, `pnpm test` from the repo root.
- Manual testnet smoke: sign up (trustline auto-added) → balance shows XLM + TAK → buy coffee /
  send TAK to a second registered account → bot `/balance` returns both lines.

## Open question (post-plan)

- The concrete `TAK_ISSUER_PUBLIC_KEY` value (from cafe-bazi's `.env.testnet.json` or wherever the
  real issuer lives) must be supplied to populate `[vars]` and `.dev.vars`.
