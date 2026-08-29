import { eq } from 'drizzle-orm';
import { initTRPC, TRPCError } from '@trpc/server';
import { jwtVerify } from 'jose';
import { users } from '@takapp/shared/db';
import type { User } from '@takapp/shared/db';
import type { TrpcContext } from './context';

const t = initTRPC.context<TrpcContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export interface AuthedContext extends TrpcContext {
  user: User;
}

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  const header = ctx.req.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!token) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing session token' });
  }
  let sub: string | undefined;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(ctx.env.JWT_SECRET));
    sub = payload.sub;
  } catch {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid session token' });
  }
  if (!sub) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid session token' });
  }
  const [user] = await ctx.db.select().from(users).where(eq(users.stellarPublicKey, sub)).limit(1);
  if (!user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Unknown account' });
  }
  return next({ ctx: { ...ctx, user } });
});
