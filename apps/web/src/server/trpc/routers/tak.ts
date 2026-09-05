import { claimTak, getClaimStatus, withTakErrors } from '../../tak/service';
import { protectedProcedure, router } from '../trpc';

export const takRouter = router({
  status: protectedProcedure.query(({ ctx }) =>
    withTakErrors(() => getClaimStatus(ctx.db, ctx.user.id)),
  ),

  claim: protectedProcedure.mutation(({ ctx }) =>
    withTakErrors(() =>
      claimTak(ctx.db, ctx.env, {
        userId: ctx.user.id,
        stellarPublicKey: ctx.user.stellarPublicKey,
      }),
    ),
  ),
});
