import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { coffeeShops, orders, users } from '@takapp/shared/db';
import { attachMenus } from '../../shop/service';
import { protectedProcedure, publicProcedure, router } from '../trpc';

const getInput = z.object({ id: z.number().int().positive() });

export const shopsRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ shop: coffeeShops, owner: users })
      .from(coffeeShops)
      .leftJoin(users, eq(coffeeShops.ownerUserId, users.id))
      .where(eq(coffeeShops.isActive, true));
    const shops = await attachMenus(ctx.db, rows);
    return { shops };
  }),

  get: publicProcedure.input(getInput).query(async ({ ctx, input }) => {
    const rows = await ctx.db
      .select({ shop: coffeeShops, owner: users })
      .from(coffeeShops)
      .leftJoin(users, eq(coffeeShops.ownerUserId, users.id))
      .where(eq(coffeeShops.id, input.id))
      .limit(1);
    const [shop] = await attachMenus(ctx.db, rows);
    if (!shop) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Coffee shop not found' });
    }
    return { shop };
  }),

  listForMe: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ shop: coffeeShops, owner: users })
      .from(coffeeShops)
      .leftJoin(users, eq(coffeeShops.ownerUserId, users.id))
      .where(eq(coffeeShops.isActive, true));
    const shops = await attachMenus(ctx.db, rows);
    const orderRows = await ctx.db.select().from(orders).where(eq(orders.userId, ctx.user.id));
    const counts = new Map<number, number>();
    for (const row of orderRows) {
      counts.set(row.coffeeShopId, (counts.get(row.coffeeShopId) ?? 0) + 1);
    }
    return {
      shops: shops.map((shop) => ({ ...shop, previousOrderCount: counts.get(shop.id) ?? 0 })),
    };
  }),
});
