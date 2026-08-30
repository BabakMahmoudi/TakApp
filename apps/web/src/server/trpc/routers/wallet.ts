import { Horizon } from '@stellar/stellar-sdk/no-axios';
import { balanceSchema } from '@takapp/shared/zod-schemas';
import { fetchBalances } from '../../stellar/horizon';
import { protectedProcedure, publicProcedure, router } from '../trpc';

export const walletRouter = router({
  balance: protectedProcedure.input(balanceSchema).query(async ({ ctx, input }) => {
    const server = new Horizon.Server(ctx.env.HORIZON_URL);
    const balances = await fetchBalances(server, ctx.user.stellarPublicKey, ctx.env.TAK_ISSUER);
    const filtered = input.asset ? balances.filter((entry) => entry.asset === input.asset) : balances;
    return { balances: filtered, updatedAt: Date.now() };
  }),

  networkConfig: publicProcedure.query(async ({ ctx }) => {
    return {
      horizonUrl: ctx.env.HORIZON_URL,
      networkPassphrase: ctx.env.NETWORK_PASSPHRASE,
      takAsset: { code: 'TAK', issuer: ctx.env.TAK_ISSUER },
    };
  }),
});
