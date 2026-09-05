import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { pushSubscriptions } from '@takapp/shared/db';
import { pushSubscriptionSchema } from '@takapp/shared/zod-schemas';
import { protectedProcedure, publicProcedure, router } from '../trpc';

const unsubscribeInput = z.object({ endpoint: z.string().min(1).max(2048) });

export const pushRouter = router({
  publicKey: publicProcedure.query(({ ctx }) => ({ vapidPublicKey: ctx.env.VAPID_PUBLIC_KEY })),

  subscribe: protectedProcedure.input(pushSubscriptionSchema).mutation(async ({ ctx, input }) => {
    await ctx.db
      .insert(pushSubscriptions)
      .values({
        userId: ctx.user.id,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: ctx.user.id, p256dh: input.p256dh, auth: input.auth },
      });
    return { ok: true };
  }),

  unsubscribe: protectedProcedure.input(unsubscribeInput).mutation(async ({ ctx, input }) => {
    await ctx.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, input.endpoint), eq(pushSubscriptions.userId, ctx.user.id)));
    return { ok: true };
  }),
});
