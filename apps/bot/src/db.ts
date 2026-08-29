import { eq } from 'drizzle-orm';
import { coffeeShops, payments, telegramBindings, users } from '@takapp/shared/db';
import type { D1Database } from '@cloudflare/workers-types';
import { drizzle } from 'drizzle-orm/d1';
import type { BotEnv } from './env';

export interface BoundUser {
  publicKey: string;
}

export interface BotDataAccess {
  findUserByTelegramId(telegramUserId: number): Promise<BoundUser | null>;
  listShops(): Promise<{ name: string; address: string | null }[]>;
  listPayments(publicKey: string, limit: number): Promise<{ amount: string; asset: string; createdAt: Date }[]>;
}

export function createDataAccess(env: BotEnv): BotDataAccess {
  const db = drizzle(env.DB);

  return {
    async findUserByTelegramId(telegramUserId: number): Promise<BoundUser | null> {
      const [binding] = await db
        .select()
        .from(telegramBindings)
        .where(eq(telegramBindings.telegramUserId, telegramUserId))
        .limit(1);
      if (!binding || !binding.isAuthorized) return null;
      const [user] = await db.select().from(users).where(eq(users.id, binding.userId)).limit(1);
      return user ? { publicKey: user.stellarPublicKey } : null;
    },

    async listShops() {
      const rows = await db.select().from(coffeeShops).where(eq(coffeeShops.isActive, true));
      return rows.map((shop) => ({ name: shop.name, address: shop.address }));
    },

    async listPayments(publicKey: string, limit: number) {
      const [user] = await db.select().from(users).where(eq(users.stellarPublicKey, publicKey)).limit(1);
      if (!user) return [];
      const rows = await db.select().from(payments).where(eq(payments.userId, user.id)).limit(limit);
      return rows.map((payment) => ({
        amount: payment.amount,
        asset: payment.asset,
        createdAt: payment.createdAt,
      }));
    },
  };
}

export type D1Like = Pick<D1Database, 'prepare' | 'batch'>;
