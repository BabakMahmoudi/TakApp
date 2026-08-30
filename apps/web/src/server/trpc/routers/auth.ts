import { and, eq, lt } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { hashPassword } from '@takapp/shared/password';
import { sessions, users } from '@takapp/shared/db';
import { challengeSchema, loginSchema, signupSchema } from '@takapp/shared/zod-schemas';
import { d1Probe, logStep, serializeError } from '../../logging';
import { fundNewAccount } from '../../stellar/funding';
import { buildChallengeXdr, verifyChallengeXdr } from '../../stellar/sep10';
import { issueSessionToken } from '../../stellar/session-token';
import { publicProcedure, router } from '../trpc';
import type { WorkerEnv } from '../env';

const CHALLENGE_TTL_MS = 10 * 60 * 1000;

let diagnosticsLogged = false;

async function probeHorizon(horizonUrl: string) {
  const started = Date.now();
  try {
    const res = await fetch(`${horizonUrl.replace(/\/+$/, '')}/`, { signal: AbortSignal.timeout(10_000) });
    console.log(
      `[diagnostics] horizon ${res.ok ? `ok ${res.status}` : `http ${res.status}`} (${Date.now() - started}ms)`,
    );
    return { horizonReachable: res.ok, status: res.status, durationMs: Date.now() - started, error: null as string | null };
  } catch (error) {
    console.error(`[diagnostics] horizon FAILED (${Date.now() - started}ms): ${serializeError(error)}`);
    return { horizonReachable: false, status: null as number | null, durationMs: Date.now() - started, error: serializeError(error) };
  }
}

async function runDiagnostics(env: WorkerEnv) {
  const horizon = await probeHorizon(env.HORIZON_URL);
  const d1 = await d1Probe(env.DB);
  return {
    horizonReachable: horizon.horizonReachable,
    horizonStatus: horizon.status,
    horizonDurationMs: horizon.durationMs,
    horizonError: horizon.error,
    d1Ok: d1.ok,
    d1DurationMs: d1.durationMs,
  };
}

export const authRouter = router({
  clientLog: publicProcedure
    .input(z.object({ message: z.string().max(2000) }))
    .mutation(async ({ ctx, input }) => {
      console.log(`[client] reqId=${ctx.reqId} ${input.message}`);
      return { ok: true };
    }),

  signup: publicProcedure.input(signupSchema).mutation(async ({ ctx, input }) => {
    const rid = ctx.reqId;
    console.log(
      `[signup] mutation start reqId=${rid} pubkey=${input.publicKey.slice(0, 6)} hasEmail=${input.email != null && input.email.length > 0}`,
    );
    if (!diagnosticsLogged) {
      diagnosticsLogged = true;
      console.log(`[diagnostics] first signup attempt reqId=${rid}; running probes`);
      await runDiagnostics(ctx.env);
    }
    const existingQuery = ctx.db
      .select()
      .from(users)
      .where(eq(users.stellarPublicKey, input.publicKey))
      .limit(1);
    console.log(`[signup] existing-user-check sql=${existingQuery.toSQL().sql}`);
    const [existing] = await logStep('existing-user-check', async () => existingQuery);
    if (existing) {
      throw new TRPCError({ code: 'CONFLICT', message: 'This account is already registered' });
    }
    const passwordHash = await logStep('hash-password', () => hashPassword(input.password));
    await logStep('fund-new-account', () =>
      fundNewAccount({
        horizonUrl: ctx.env.HORIZON_URL,
        networkPassphrase: ctx.env.NETWORK_PASSPHRASE,
        fundingSecret: ctx.env.FUNDING_SECRET,
        destination: input.publicKey,
      }),
    );
    await logStep('insert-user', async () =>
      ctx.db.insert(users).values({
        stellarPublicKey: input.publicKey,
        email: input.email ?? null,
        phone: input.phone ?? null,
        passwordHash,
        createdAt: new Date(),
      }),
    );
    return { ok: true };
  }),

  diagnostics: publicProcedure.query(async ({ ctx }) => {
    return runDiagnostics(ctx.env);
  }),

  challenge: publicProcedure.input(challengeSchema).mutation(async ({ ctx, input }) => {
    console.log(`[auth] challenge publicKey=${input.publicKey}`);
    const [user] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.stellarPublicKey, input.publicKey))
      .limit(1);
    console.log(`[auth] challenge user=${user ? 'found' : 'NOT FOUND'}`);
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
