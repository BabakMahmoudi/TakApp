import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { coffeeShops, payments, users } from '@takapp/shared/db';
import { paymentRecordSchema } from '@takapp/shared/zod-schemas';
import { protectedProcedure, router } from '../trpc';

export const paymentsRouter = router({
  record: protectedProcedure.input(paymentRecordSchema).mutation(async ({ ctx, input }) => {
    let coffeeShopId: number | undefined;
    let recipientPublicKey: string;

    if (input.coffeeShopId !== undefined) {
      const [shop] = await ctx.db.select().from(coffeeShops).where(eq(coffeeShops.id, input.coffeeShopId)).limit(1);
      if (!shop || !shop.isActive) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Coffee shop not found' });
      }
      if (!shop.ownerUserId) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Shop has no payment account' });
      }
      const [owner] = await ctx.db.select().from(users).where(eq(users.id, shop.ownerUserId)).limit(1);
      if (!owner) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Shop has no payment account' });
      }
      coffeeShopId = shop.id;
      recipientPublicKey = owner.stellarPublicKey;
    } else {
      const recipient = input.recipientPublicKey;
      if (!recipient) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Missing recipient' });
      }
      if (recipient === ctx.user.stellarPublicKey) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Cannot send to yourself' });
      }
      const [recipientUser] = await ctx.db.select().from(users).where(eq(users.stellarPublicKey, recipient)).limit(1);
      if (!recipientUser) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Recipient not found' });
      }
      recipientPublicKey = recipient;
    }

    const inserted = await ctx.db
      .insert(payments)
      .values({
        userId: ctx.user.id,
        coffeeShopId: coffeeShopId ?? null,
        recipientPublicKey,
        amount: input.amount,
        asset: input.asset,
        txHash: input.txHash,
        status: 'submitted',
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();

    // Idempotent: a retry after a network failure reports the same tx hash and
    // must not double-insert; return the existing row's id instead.
    const [row] = inserted.length > 0 ? inserted : await ctx.db.select().from(payments).where(eq(payments.txHash, input.txHash)).limit(1);
    if (!row) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to record payment' });
    }
    return { ok: true, id: row.id };
  }),
});
