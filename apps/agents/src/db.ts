import { desc, eq } from 'drizzle-orm';
import { coffeeShops, menuItems, orders, payments, users } from '@takapp/shared/db';
import { drizzle } from 'drizzle-orm/d1';
import type { AgentEnv } from './env';

export interface ShopSummary {
  id: number;
  name: string;
  address: string | null;
}

export interface MenuItemSummary {
  name: string;
  price: string;
}

export interface PaymentSummary {
  amount: string;
  asset: string;
  createdAt: Date;
}

export interface OrderSummary {
  id: number;
  totalAmount: string;
  status: string;
  createdAt: Date;
}

export interface AgentDataAccess {
  listShops(): Promise<ShopSummary[]>;
  getShopMenu(shopId: number): Promise<MenuItemSummary[]>;
  listPayments(publicKey: string, limit: number): Promise<PaymentSummary[]>;
  listOrders(publicKey: string, limit: number): Promise<OrderSummary[]>;
}

export function createDataAccess(env: AgentEnv): AgentDataAccess {
  const db = drizzle(env.DB);

  async function userIdByPublicKey(publicKey: string): Promise<number | null> {
    const [user] = await db.select().from(users).where(eq(users.stellarPublicKey, publicKey)).limit(1);
    return user ? user.id : null;
  }

  return {
    async listShops() {
      const rows = await db.select().from(coffeeShops).where(eq(coffeeShops.isActive, true));
      return rows.map((shop) => ({ id: shop.id, name: shop.name, address: shop.address }));
    },

    async getShopMenu(shopId) {
      const rows = await db
        .select()
        .from(menuItems)
        .where(eq(menuItems.coffeeShopId, shopId))
        .orderBy(menuItems.sortOrder);
      return rows.map((item) => ({ name: item.name, price: item.price }));
    },

    async listPayments(publicKey, limit) {
      const userId = await userIdByPublicKey(publicKey);
      if (userId === null) return [];
      const rows = await db
        .select()
        .from(payments)
        .where(eq(payments.userId, userId))
        .orderBy(desc(payments.createdAt))
        .limit(limit);
      return rows.map((payment) => ({
        amount: payment.amount,
        asset: payment.asset,
        createdAt: payment.createdAt,
      }));
    },

    async listOrders(publicKey, limit) {
      const userId = await userIdByPublicKey(publicKey);
      if (userId === null) return [];
      const rows = await db
        .select()
        .from(orders)
        .where(eq(orders.userId, userId))
        .orderBy(desc(orders.createdAt))
        .limit(limit);
      return rows.map((order) => ({
        id: order.id,
        totalAmount: order.totalAmount,
        status: order.status,
        createdAt: order.createdAt,
      }));
    },
  };
}
