import { takOfferInputSchema } from '@takapp/shared/zod-schemas';
import { list, remove, renew, upsert, withOfferErrors } from '../../offers/service';
import { protectedProcedure, router } from '../trpc';

export const offersRouter = router({
  list: protectedProcedure.query(({ ctx }) => withOfferErrors(() => list(ctx.db, ctx.user.id))),

  upsert: protectedProcedure.input(takOfferInputSchema).mutation(({ ctx, input }) =>
    withOfferErrors(() => upsert(ctx.db, ctx.user.id, input)),
  ),

  renew: protectedProcedure.mutation(({ ctx }) => withOfferErrors(() => renew(ctx.db, ctx.user.id))),

  delete: protectedProcedure.mutation(({ ctx }) =>
    withOfferErrors(async () => {
      await remove(ctx.db, ctx.user.id);
      return { ok: true };
    }),
  ),
});
