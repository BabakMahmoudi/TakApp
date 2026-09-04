import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { coffeeShops, users } from '@takapp/shared/db';
import { menuItemInputSchema } from '@takapp/shared/zod-schemas';
import { assertCanEditShop, attachMenus, saveMenuForShop } from '../../shop/service';
import { protectedProcedure, router } from '../trpc';

const latitudeSchema = z.number().min(-90).max(90);
const longitudeSchema = z.number().min(-180).max(180);

const updateInput = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(120).optional(),
  address: z.string().max(240).optional(),
  quoteOfTheDay: z.string().max(240).optional(),
  latitude: latitudeSchema.nullable().optional(),
  longitude: longitudeSchema.nullable().optional(),
});

const saveMenuInput = z.object({
  shopId: z.number().int().positive(),
  items: z.array(menuItemInputSchema),
});

export const ownerRouter = router({
  mine: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ shop: coffeeShops, owner: users })
      .from(coffeeShops)
      .leftJoin(users, eq(coffeeShops.ownerUserId, users.id))
      .where(eq(coffeeShops.ownerUserId, ctx.user.id));
    const shops = await attachMenus(ctx.db, rows);
    return { shops };
  }),

  update: protectedProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    await assertCanEditShop(ctx.db, ctx.user, ctx.env.ADMIN_PUBLIC_KEY, input.id);
    const updates: Partial<typeof coffeeShops.$inferInsert> = {};
    if (input.name !== undefined) updates.name = input.name;
    if (input.address !== undefined) updates.address = input.address === '' ? null : input.address;
    if (input.quoteOfTheDay !== undefined) {
      updates.quoteOfTheDay = input.quoteOfTheDay === '' ? null : input.quoteOfTheDay;
    }
    if (input.latitude !== undefined) updates.latitude = input.latitude;
    if (input.longitude !== undefined) updates.longitude = input.longitude;
    await ctx.db.update(coffeeShops).set(updates).where(eq(coffeeShops.id, input.id));
    return { ok: true };
  }),

  saveMenu: protectedProcedure.input(saveMenuInput).mutation(async ({ ctx, input }) => {
    await assertCanEditShop(ctx.db, ctx.user, ctx.env.ADMIN_PUBLIC_KEY, input.shopId);
    await saveMenuForShop(ctx.db, input.shopId, input.items);
    return { ok: true };
  }),
});
