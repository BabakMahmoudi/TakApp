import { eq } from 'drizzle-orm';
import { coffeeShops, users } from '@takapp/shared/db';
import { attachMenus } from '../../shop/service';
import { publicProcedure, router } from '../trpc';

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
});
