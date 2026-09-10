import { Horizon } from '@stellar/stellar-sdk/no-axios';
import { Server as SorobanRpc } from '@stellar/stellar-sdk/no-axios/rpc';
import { balanceSchema } from '@takapp/shared/zod-schemas';
import { isLocalHttpUrl } from '@takapp/shared/url';
import { fetchBalances, fetchTakBalanceOnly } from '../../stellar/horizon';
import { protectedProcedure, publicProcedure, router } from '../trpc';
import { readTakBalanceCache, writeTakBalanceCache } from '../../wallet/balance-cache';
import type { BalanceEntry } from '../../stellar/horizon';

function takStroops(balances: BalanceEntry[]): string {
  return balances.find((entry) => entry.asset === 'TAK')?.stroops ?? '0';
}

export const walletRouter = router({
  balance: protectedProcedure.input(balanceSchema).query(async ({ ctx, input }) => {
    const server = new Horizon.Server(ctx.env.HORIZON_URL, { allowHttp: isLocalHttpUrl(ctx.env.HORIZON_URL) });
    const rpc = new SorobanRpc(ctx.env.SOROBAN_RPC_URL, { allowHttp: isLocalHttpUrl(ctx.env.SOROBAN_RPC_URL) });
    const balances = await fetchBalances(
      server,
      rpc,
      ctx.user.stellarPublicKey,
      ctx.env.TAK_CONTRACT_ID,
    );
    await writeTakBalanceCache(ctx.db, ctx.user.id, takStroops(balances));
    const filtered = input.asset ? balances.filter((entry) => entry.asset === input.asset) : balances;
    return { balances: filtered, updatedAt: Date.now() };
  }),

  takBalance: protectedProcedure.query(async ({ ctx }) => {
    const cached = await readTakBalanceCache(ctx.db, ctx.user.id);
    if (cached) {
      return { takStroops: cached.takStroops, updatedAt: cached.updatedAt.getTime(), source: 'cache' as const };
    }
    const rpc = new SorobanRpc(ctx.env.SOROBAN_RPC_URL, { allowHttp: isLocalHttpUrl(ctx.env.SOROBAN_RPC_URL) });
    const stroops = await fetchTakBalanceOnly(rpc, ctx.user.stellarPublicKey, ctx.env.TAK_CONTRACT_ID);
    await writeTakBalanceCache(ctx.db, ctx.user.id, stroops);
    return { takStroops: stroops, updatedAt: Date.now(), source: 'network' as const };
  }),

  refreshTakBalance: protectedProcedure.mutation(async ({ ctx }) => {
    const rpc = new SorobanRpc(ctx.env.SOROBAN_RPC_URL, { allowHttp: isLocalHttpUrl(ctx.env.SOROBAN_RPC_URL) });
    const stroops = await fetchTakBalanceOnly(rpc, ctx.user.stellarPublicKey, ctx.env.TAK_CONTRACT_ID);
    await writeTakBalanceCache(ctx.db, ctx.user.id, stroops);
    return { takStroops: stroops, updatedAt: Date.now() };
  }),

  networkConfig: publicProcedure.query(async ({ ctx }) => {
    const origin = new URL(ctx.req.url).origin;
    return {
      horizonUrl: ctx.env.HORIZON_PUBLIC_URL ?? `${origin}/api/stellar/horizon`,
      networkPassphrase: ctx.env.NETWORK_PASSPHRASE,
      sorobanRpcUrl: ctx.env.SOROBAN_PUBLIC_RPC_URL ?? `${origin}/api/stellar/soroban`,
      takToken: { code: 'TAK', contractId: ctx.env.TAK_CONTRACT_ID, decimals: 7 },
    };
  }),
});
