import { eq } from 'drizzle-orm';
import { initTRPC, TRPCError } from '@trpc/server';
import { jwtVerify } from 'jose';
import { users } from '@takapp/shared/db';
import type { User } from '@takapp/shared/db';
import { isAdminUser } from '../admin/guards';
import { serializeError } from '../logging';
import type { TrpcContext } from './context';

const t = initTRPC.context<TrpcContext>().create();

export const router = t.router;

const logMiddleware = t.middleware(async ({ ctx, path, next }) => {
  const started = Date.now();
  console.log(`[trpc] start ${path} reqId=${ctx.reqId}`);
  try {
    const result = await next();
    console.log(`[trpc] ok ${path} (${Date.now() - started}ms) reqId=${ctx.reqId}`);
    return result;
  } catch (error) {
    console.error(`[trpc] error ${path} (${Date.now() - started}ms) reqId=${ctx.reqId}: ${serializeError(error)}`);
    throw error;
  }
});

export const publicProcedure = t.procedure.use(logMiddleware);

export interface AuthedContext extends TrpcContext {
  user: User;
}

export const protectedProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const header = ctx.req.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!token) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing session token' });
  }
  let sub: string | undefined;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(ctx.env.JWT_SECRET));
    if (payload.typ !== 'user') {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid session token' });
    }
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

export interface AdminContext extends AuthedContext {
  admin: User;
}

export const adminProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const token = ctx.req.headers.get('x-admin-token');
  if (!token) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing admin token' });
  }
  let sub: string | undefined;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(ctx.env.ADMIN_JWT_SECRET));
    if (payload.typ !== 'admin') {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid admin token' });
    }
    sub = payload.sub;
  } catch {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid admin token' });
  }
  const userId = Number(sub);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid admin token' });
  }
  const [user] = await ctx.db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !isAdminUser(user, ctx.env.ADMIN_PUBLIC_KEY)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not an admin' });
  }
  return next({ ctx: { ...ctx, user, admin: user } });
});
