import { eq, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { coffeeShops, menuItems } from '@takapp/shared/db';
import type { CoffeeShop, User } from '@takapp/shared/db';
import { isPositiveStroops } from '@takapp/shared/money';
import type { MenuItemInput } from '@takapp/shared/zod-schemas';
import { isAdminUser } from '../admin/guards';
import type { TrpcContext } from '../trpc/context';

export type ShopOwner = Pick<User, 'id' | 'role' | 'stellarPublicKey'>;

export interface ShapedShop {
  id: number;
  name: string;
  address: string | null;
  quoteOfTheDay: string | null;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
  ownerPublicKey: string | null;
  menu: { id: number; name: string; price: string }[];
}

export async function assertCanEditShop(
  db: TrpcContext['db'],
  user: ShopOwner,
  envAdminKey: string,
  shopId: number,
): Promise<CoffeeShop> {
  const [shop] = await db.select().from(coffeeShops).where(eq(coffeeShops.id, shopId)).limit(1);
  if (!shop) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Coffee shop not found' });
  }
  if (shop.ownerUserId !== user.id && !isAdminUser(user, envAdminKey)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to edit this shop' });
  }
  return shop;
}

export async function saveMenuForShop(
  db: TrpcContext['db'],
  shopId: number,
  items: MenuItemInput[],
): Promise<void> {
  for (const item of items) {
    if (!isPositiveStroops(item.price)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Price must be greater than zero' });
    }
  }
  const now = new Date();
  await db.batch([
    db.delete(menuItems).where(eq(menuItems.coffeeShopId, shopId)),
    ...items.map((item, index) =>
      db.insert(menuItems).values({
        coffeeShopId: shopId,
        name: item.name,
        price: item.price,
        sortOrder: index,
        createdAt: now,
      }),
    ),
  ]);
}

export async function attachMenus(
  db: TrpcContext['db'],
  rows: { shop: CoffeeShop; owner: User | null }[],
): Promise<ShapedShop[]> {
  if (rows.length === 0) return [];
  const shopIds = rows.map((row) => row.shop.id);
  const menuRows = await db.select().from(menuItems).where(inArray(menuItems.coffeeShopId, shopIds));
  menuRows.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const byShop = new Map<number, { id: number; name: string; price: string }[]>();
  for (const item of menuRows) {
    const list = byShop.get(item.coffeeShopId) ?? [];
    list.push({ id: item.id, name: item.name, price: item.price });
    byShop.set(item.coffeeShopId, list);
  }
  return rows.map(({ shop, owner }) => ({
    id: shop.id,
    name: shop.name,
    address: shop.address,
    quoteOfTheDay: shop.quoteOfTheDay,
    latitude: shop.latitude,
    longitude: shop.longitude,
    isActive: shop.isActive,
    ownerPublicKey: owner?.stellarPublicKey ?? null,
    menu: byShop.get(shop.id) ?? [],
  }));
}
