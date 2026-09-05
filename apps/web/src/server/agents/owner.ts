import { eq } from 'drizzle-orm';
import { jwtVerify } from 'jose';
import { users } from '@takapp/shared/db';
import type { TrpcContext } from '../trpc/context';

export type AgentOwner =
  | { kind: 'user'; userId: number; publicKey: string }
  | { kind: 'anonymous'; anonymousKey: string }
  | { kind: 'none' };

export async function resolveAgentOwner(
  db: TrpcContext['db'],
  req: Request,
  jwtSecret: string,
): Promise<AgentOwner> {
  const header = req.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret));
      if (payload.typ === 'user' && typeof payload.sub === 'string') {
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.stellarPublicKey, payload.sub))
          .limit(1);
        if (user) return { kind: 'user', userId: user.id, publicKey: user.stellarPublicKey };
      }
    } catch {
      // Invalid/expired session falls back to anonymous.
    }
  }
  const anonymousKey = req.headers.get('x-anonymous-key');
  if (anonymousKey) return { kind: 'anonymous', anonymousKey };
  return { kind: 'none' };
}
