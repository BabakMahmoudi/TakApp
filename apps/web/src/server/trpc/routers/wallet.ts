import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { Horizon } from '@stellar/stellar-sdk/no-axios';
import { balanceSchema } from '@takapp/shared/zod-schemas';
import { gifts } from '@takapp/shared/db';
import { sendTakGift } from '../../stellar/funding';
import { fetchBalances, hasTrustline } from '../../stellar/horizon';
import { protectedProcedure, publicProcedure, router } from '../trpc';

export const TAK_WELCOME_GIFT_STROOPS = '100000000';

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

  claimGift: protectedProcedure.mutation(async ({ ctx }) => {
    const [existing] = await ctx.db
      .select()
      .from(gifts)
      .where(and(eq(gifts.userId, ctx.user.id), eq(gifts.type, 'tak-welcome')))
      .limit(1);
    if (existing) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Gift already claimed' });
    }
    const server = new Horizon.Server(ctx.env.HORIZON_URL);
    if (!(await hasTrustline(server, ctx.user.stellarPublicKey, ctx.env.TAK_ISSUER))) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'TAK trustline required' });
    }
    // The funding account issues the TAK gift; only insert the gifts row after
    // the on-chain send succeeded so a Horizon failure never mints a record.
    await sendTakGift({
      horizonUrl: ctx.env.HORIZON_URL,
      networkPassphrase: ctx.env.NETWORK_PASSPHRASE,
      fundingSecret: ctx.env.FUNDING_SECRET,
      takIssuer: ctx.env.TAK_ISSUER,
      destination: ctx.user.stellarPublicKey,
    });
    const [gift] = await ctx.db
      .insert(gifts)
      .values({
        userId: ctx.user.id,
        type: 'tak-welcome',
        amount: TAK_WELCOME_GIFT_STROOPS,
        createdAt: new Date(),
      })
      .returning();
    if (!gift) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to record gift' });
    }
    return { amount: gift.amount };
  }),
});
