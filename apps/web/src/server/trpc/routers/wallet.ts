import { Horizon } from '@stellar/stellar-sdk/no-axios';
import { Server as SorobanRpc } from '@stellar/stellar-sdk/no-axios/rpc';
import { balanceSchema } from '@takapp/shared/zod-schemas';
import { isLocalHttpUrl } from '@takapp/shared/url';
import { fetchBalances } from '../../stellar/horizon';
import { protectedProcedure, publicProcedure, router } from '../trpc';

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
    const filtered = input.asset ? balances.filter((entry) => entry.asset === input.asset) : balances;
    return { balances: filtered, updatedAt: Date.now() };
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
