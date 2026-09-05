import { eq, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { coffeeShops, menuItems, orderItems, orders, payments, users } from '@takapp/shared/db';
import type { OrderItem, User } from '@takapp/shared/db';
import { addStroops, mulStroops } from '@takapp/shared/money';
import { markOrderReadySchema, placeOrderSchema } from '@takapp/shared/zod-schemas';
import { assertCanEditShop } from '../../shop/service';
import { notifyUser } from '../../push/web-push';
import type { VapidConfig } from '../../push/web-push';
import { protectedProcedure, router } from '../trpc';
import type { WorkerEnv } from '../env';

function itemsText(items: { name: string; quantity: number }[]): string {
  return items.map((item) => `${item.quantity} ${item.name}`).join(' + ');
}

function vapidFromEnv(env: WorkerEnv): VapidConfig {
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
}

export const ordersRouter = router({
  place: protectedProcedure.input(placeOrderSchema).mutation(async ({ ctx, input }) => {
    const [existing] = await ctx.db.select().from(payments).where(eq(payments.txHash, input.txHash)).limit(1);
    if (existing) {
      if (existing.orderId) {
        const [order] = await ctx.db.select().from(orders).where(eq(orders.id, existing.orderId)).limit(1);
        if (order) return { orderId: order.id, totalAmount: order.totalAmount };
      }
      throw new TRPCError({ code: 'CONFLICT', message: 'Transaction already recorded for a non-order payment' });
    }

    const [shop] = await ctx.db.select().from(coffeeShops).where(eq(coffeeShops.id, input.shopId)).limit(1);
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

    const itemIds = input.items.map((item) => item.menuItemId);
    if (new Set(itemIds).size !== itemIds.length) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Duplicate menu item in order' });
    }
    const menuRows = await ctx.db.select().from(menuItems).where(inArray(menuItems.id, itemIds));
    if (menuRows.length !== itemIds.length) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown menu item' });
    }
    const menuById = new Map(menuRows.map((row) => [row.id, row]));

    const snapshots: { menuItemId: number; name: string; unitPrice: string; quantity: number }[] = [];
    let total = '0';
    for (const item of input.items) {
      const row = menuById.get(item.menuItemId);
      if (!row || row.coffeeShopId !== shop.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Menu item does not belong to this shop' });
      }
      snapshots.push({ menuItemId: item.menuItemId, name: row.name, unitPrice: row.price, quantity: item.quantity });
      total = addStroops(total, mulStroops(row.price, item.quantity));
    }
    if (total !== input.amount) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Menu changed' });
    }

    const now = new Date();
    const [order] = await ctx.db
      .insert(orders)
      .values({
        userId: ctx.user.id,
        coffeeShopId: shop.id,
        totalAmount: total,
        status: 'placed',
        createdAt: now,
      })
      .returning();
    if (!order) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create order' });
    }

    await ctx.db.batch([
      ctx.db.insert(payments).values({
        userId: ctx.user.id,
        coffeeShopId: shop.id,
        orderId: order.id,
        recipientPublicKey: owner.stellarPublicKey,
        amount: total,
        asset: 'TAK',
        txHash: input.txHash,
        status: 'submitted',
        createdAt: now,
      }),
      ...snapshots.map((snapshot) =>
        ctx.db.insert(orderItems).values({
          orderId: order.id,
          menuItemId: snapshot.menuItemId,
          name: snapshot.name,
          unitPrice: snapshot.unitPrice,
          quantity: snapshot.quantity,
        }),
      ),
    ]);

    await notifyUser(ctx.db, vapidFromEnv(ctx.env), shop.ownerUserId, {
      title: 'New order',
      body: itemsText(snapshots),
      url: '/owner',
    });

    return { orderId: order.id, totalAmount: total };
  }),

  my: protectedProcedure.query(async ({ ctx }) => {
    const orderRows = await ctx.db.select().from(orders).where(eq(orders.userId, ctx.user.id));
    orderRows.sort((a, b) => b.id - a.id);
    const orderIds = orderRows.map((row) => row.id);
    const shopIds = [...new Set(orderRows.map((row) => row.coffeeShopId))];

    let shopRows: { id: number; name: string }[] = [];
    let itemRows: OrderItem[] = [];
    if (orderRows.length > 0) {
      shopRows = await ctx.db.select().from(coffeeShops).where(inArray(coffeeShops.id, shopIds));
      itemRows = await ctx.db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds));
    }
    const shopName = new Map(shopRows.map((row) => [row.id, row.name]));
    const itemsByOrder = new Map<number, { name: string; quantity: number; unitPrice: string }[]>();
    for (const item of itemRows) {
      const list = itemsByOrder.get(item.orderId) ?? [];
      list.push({ name: item.name, quantity: item.quantity, unitPrice: item.unitPrice });
      itemsByOrder.set(item.orderId, list);
    }

    return {
      orders: orderRows.map((order) => {
        const items = itemsByOrder.get(order.id) ?? [];
        return {
          id: order.id,
          coffeeShopId: order.coffeeShopId,
          shopName: shopName.get(order.coffeeShopId) ?? '',
          totalAmount: order.totalAmount,
          status: order.status,
          createdAt: order.createdAt.getTime(),
          readyAt: order.readyAt?.getTime() ?? null,
          items,
          itemsText: itemsText(items),
        };
      }),
    };
  }),

  listForOwner: protectedProcedure.query(async ({ ctx }) => {
    const shopRows = await ctx.db.select().from(coffeeShops).where(eq(coffeeShops.ownerUserId, ctx.user.id));
    const shopIds = shopRows.map((row) => row.id);
    if (shopIds.length === 0) return { orders: [] };

    const orderRows = await ctx.db.select().from(orders).where(inArray(orders.coffeeShopId, shopIds));
    orderRows.sort((a, b) => b.id - a.id);
    const orderIds = orderRows.map((row) => row.id);
    const userIds = [...new Set(orderRows.map((row) => row.userId))];

    let itemRows: OrderItem[] = [];
    let customerRows: User[] = [];
    if (orderRows.length > 0) {
      itemRows = await ctx.db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds));
      customerRows = await ctx.db.select().from(users).where(inArray(users.id, userIds));
    }

    const shopName = new Map(shopRows.map((row) => [row.id, row.name]));
    const customerById = new Map(customerRows.map((row) => [row.id, row]));
    const itemsByOrder = new Map<number, { name: string; quantity: number }[]>();
    for (const item of itemRows) {
      const list = itemsByOrder.get(item.orderId) ?? [];
      list.push({ name: item.name, quantity: item.quantity });
      itemsByOrder.set(item.orderId, list);
    }

    return {
      orders: orderRows.map((order) => {
        const customer = customerById.get(order.userId);
        return {
          id: order.id,
          coffeeShopId: order.coffeeShopId,
          shopName: shopName.get(order.coffeeShopId) ?? '',
          customerPublicKey: customer?.stellarPublicKey ?? '',
          customerDisplayName: customer?.displayName ?? null,
          totalAmount: order.totalAmount,
          status: order.status,
          createdAt: order.createdAt.getTime(),
          readyAt: order.readyAt?.getTime() ?? null,
          itemsText: itemsText(itemsByOrder.get(order.id) ?? []),
        };
      }),
    };
  }),

  markReady: protectedProcedure.input(markOrderReadySchema).mutation(async ({ ctx, input }) => {
    const [order] = await ctx.db.select().from(orders).where(eq(orders.id, input.orderId)).limit(1);
    if (!order) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }
    await assertCanEditShop(ctx.db, ctx.user, ctx.env.ADMIN_PUBLIC_KEY, order.coffeeShopId);
    if (order.status !== 'placed') {
      throw new TRPCError({ code: 'CONFLICT', message: 'Order is not pending' });
    }
    await ctx.db.update(orders).set({ status: 'ready', readyAt: new Date() }).where(eq(orders.id, order.id));

    await notifyUser(ctx.db, vapidFromEnv(ctx.env), order.userId, {
      title: 'Your order is ready',
      body: `Order #${order.id} is ready`,
      url: '/orders',
    });

    return { ok: true };
  }),
});
