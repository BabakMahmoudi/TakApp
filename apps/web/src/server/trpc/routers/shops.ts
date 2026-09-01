import { eq } from 'drizzle-orm';
import { coffeeShops, users } from '@takapp/shared/db';
import { publicProcedure, router } from '../trpc';

export const shopsRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ shop: coffeeShops, owner: users })
      .from(coffeeShops)
      .leftJoin(users, eq(coffeeShops.ownerUserId, users.id))
      .where(eq(coffeeShops.isActive, true));
    return {
      shops: rows.map((row) => ({
        id: row.shop.id,
        name: row.shop.name,
        address: row.shop.address,
        ownerPublicKey: row.owner?.stellarPublicKey ?? null,
      })),
    };
  }),
});
