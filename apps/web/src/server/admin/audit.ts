import { adminAuditLog } from '@takapp/shared/db';
import type { TrpcContext } from '../trpc/context';

export async function logAdminAction(
  db: TrpcContext['db'],
  adminId: number,
  action: string,
  target?: string,
): Promise<void> {
  await db.insert(adminAuditLog).values({
    userId: adminId,
    action,
    target: target ?? null,
    createdAt: new Date(),
  });
}
