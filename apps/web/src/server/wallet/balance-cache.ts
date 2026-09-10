import { eq } from 'drizzle-orm';
import { balanceCache } from '@takapp/shared/db';
import type { TrpcContext } from '../trpc/context';

type Db = TrpcContext['db'];

export interface CachedTakBalance {
  takStroops: string;
  updatedAt: Date;
}

export async function readTakBalanceCache(db: Db, userId: number): Promise<CachedTakBalance | null> {
  const [row] = await db.select().from(balanceCache).where(eq(balanceCache.userId, userId)).limit(1);
  return row ? { takStroops: row.takStroops, updatedAt: row.updatedAt } : null;
}

export async function writeTakBalanceCache(db: Db, userId: number, takStroops: string): Promise<void> {
  const updatedAt = new Date();
  await db
    .insert(balanceCache)
    .values({ userId, takStroops, updatedAt })
    .onConflictDoUpdate({ target: balanceCache.userId, set: { takStroops, updatedAt } });
}
