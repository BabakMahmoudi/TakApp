import { and, eq, lt } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { hashPassword } from '@takapp/shared/password';
import { sessions, users } from '@takapp/shared/db';
import { challengeSchema, loginSchema, signupSchema } from '@takapp/shared/zod-schemas';
import { fundNewAccount } from '../../stellar/funding';
import { buildChallengeXdr, verifyChallengeXdr } from '../../stellar/sep10';
import { issueSessionToken } from '../../stellar/session-token';
import { publicProcedure, router } from '../trpc';

const CHALLENGE_TTL_MS = 10 * 60 * 1000;

export const authRouter = router({
  signup: publicProcedure.input(signupSchema).mutation(async ({ ctx, input }) => {
    const [existing] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.stellarPublicKey, input.publicKey))
      .limit(1);
    if (existing) {
      throw new TRPCError({ code: 'CONFLICT', message: 'This account is already registered' });
    }
    const passwordHash = await hashPassword(input.password);
    await fundNewAccount({
      horizonUrl: ctx.env.HORIZON_URL,
      networkPassphrase: ctx.env.NETWORK_PASSPHRASE,
      fundingSecret: ctx.env.FUNDING_SECRET,
      destination: input.publicKey,
    });
    await ctx.db.insert(users).values({
      stellarPublicKey: input.publicKey,
      email: input.email ?? null,
      phone: input.phone ?? null,
      passwordHash,
      createdAt: new Date(),
    });
    return { ok: true };
  }),

  challenge: publicProcedure.input(challengeSchema).mutation(async ({ ctx, input }) => {
    const [user] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.stellarPublicKey, input.publicKey))
      .limit(1);
    if (!user) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Unknown account' });
    }
    const nonce = crypto.randomUUID();
    await ctx.db.insert(sessions).values({
      userId: user.id,
      nonce,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      createdAt: new Date(),
    });
    const challengeXdr = buildChallengeXdr({
      serverSecret: ctx.env.FUNDING_SECRET,
      clientAccountId: input.publicKey,
      networkPassphrase: ctx.env.NETWORK_PASSPHRASE,
      domainName: ctx.env.APP_DOMAIN,
    });
    return { challengeXdr, nonce, networkPassphrase: ctx.env.NETWORK_PASSPHRASE };
  }),

  login: publicProcedure
    .input(loginSchema.extend({ nonce: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [user] = await ctx.db
        .select()
        .from(users)
        .where(eq(users.stellarPublicKey, input.publicKey))
        .limit(1);
      if (!user) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Unknown account' });
      }
      const now = new Date();
      const [session] = await ctx.db
        .select()
        .from(sessions)
        .where(and(eq(sessions.nonce, input.nonce), eq(sessions.userId, user.id)))
        .limit(1);
      if (!session || session.expiresAt.getTime() < now.getTime()) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Challenge expired or unknown' });
      }
      if (session.token) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Challenge already used' });
      }
      try {
        verifyChallengeXdr({
          serverSecret: ctx.env.FUNDING_SECRET,
          clientAccountId: input.publicKey,
          networkPassphrase: ctx.env.NETWORK_PASSPHRASE,
          domainName: ctx.env.APP_DOMAIN,
          signedXdr: input.signedXdr,
        });
      } catch {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid challenge signature' });
      }
      const token = await issueSessionToken({
        secret: ctx.env.JWT_SECRET,
        publicKey: input.publicKey,
        jti: input.nonce,
      });
      await ctx.db.update(sessions).set({ token }).where(eq(sessions.id, session.id));
      return { token };
    }),

  logout: publicProcedure
    .input(z.object({ nonce: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(sessions).where(eq(sessions.nonce, input.nonce));
      return { ok: true };
    }),

  pruneExpired: publicProcedure.query(async ({ ctx }) => {
    await ctx.db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
    return { ok: true };
  }),
});
