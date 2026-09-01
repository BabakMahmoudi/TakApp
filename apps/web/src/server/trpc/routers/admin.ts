import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { generateURI } from 'otplib';
import { adminStepUpAttempts, coffeeShops, users } from '@takapp/shared/db';
import { totpProvider } from '@takapp/shared/verification';
import { stellarAccountIdSchema } from '@takapp/shared/zod-schemas';
import { logAdminAction } from '../../admin/audit';
import { canDemote, canPromote, isAdminUser, isLocked, nextThrottleState, resetThrottle } from '../../admin/guards';
import { verifyTotpCode } from '../../admin/totp';
import { decryptTotpSecret, encryptTotpSecret } from '../../admin/totp-enc';
import { issueAdminToken } from '../../stellar/session-token';
import { adminProcedure, protectedProcedure, router } from '../trpc';
import type { TrpcContext } from '../context';

const totpCodeSchema = z.string().regex(/^\d{6}$/);
const totpSecretSchema = z.string().min(16).max(200);

function isTotpRequired(env: Pick<TrpcContext['env'], 'ADMIN_TOTP_REQUIRED'>): boolean {
  return env.ADMIN_TOTP_REQUIRED !== false && env.ADMIN_TOTP_REQUIRED !== 'false';
}

const createShopInput = z.object({
  name: z.string().min(1).max(120),
  address: z.string().max(240).optional(),
  ownerPublicKey: stellarAccountIdSchema.optional(),
});

const updateShopInput = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(120).optional(),
  address: z.string().max(240).optional(),
  isActive: z.boolean().optional(),
  ownerPublicKey: z.union([z.literal(''), stellarAccountIdSchema]).optional(),
});

async function resolveOwnerUserId(
  db: TrpcContext['db'],
  ownerPublicKey: string | undefined,
): Promise<number | null | undefined> {
  if (ownerPublicKey === undefined) return undefined;
  if (ownerPublicKey === '') return null;
  const [owner] = await db.select().from(users).where(eq(users.stellarPublicKey, ownerPublicKey)).limit(1);
  if (!owner) throw new TRPCError({ code: 'NOT_FOUND', message: 'Owner account not found' });
  return owner.id;
}

export const adminRouter = router({
  status: protectedProcedure.query(async ({ ctx }) => ({
    role: ctx.user.role,
    totpEnrolled: ctx.user.totpSecret != null,
    totpRequired: isTotpRequired(ctx.env),
  })),

  enrollTotp: protectedProcedure.mutation(async ({ ctx }) => {
    if (!isAdminUser(ctx.user, ctx.env.ADMIN_PUBLIC_KEY)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Not an admin' });
    }
    if (ctx.user.totpSecret) {
      throw new TRPCError({ code: 'CONFLICT', message: 'TOTP already enrolled' });
    }
    const label = ctx.user.email ?? ctx.user.stellarPublicKey;
    const issue = await totpProvider.issue(label);
    return { secret: issue.secret as string, otpauthUri: generateURI({ issuer: 'TakApp', label, secret: issue.secret as string }) };
  }),

  confirmTotp: protectedProcedure
    .input(z.object({ code: totpCodeSchema, secret: totpSecretSchema }))
    .mutation(async ({ ctx, input }) => {
      if (!isAdminUser(ctx.user, ctx.env.ADMIN_PUBLIC_KEY)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not an admin' });
      }
      if (ctx.user.totpSecret) {
        throw new TRPCError({ code: 'CONFLICT', message: 'TOTP already enrolled' });
      }
      if (!verifyTotpCode(input.secret, input.code)) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid TOTP code' });
      }
      const encrypted = await encryptTotpSecret(input.secret, ctx.env.ADMIN_TOTP_ENC_KEY);
      await ctx.db.update(users).set({ totpSecret: encrypted }).where(eq(users.id, ctx.user.id));
      await logAdminAction(ctx.db, ctx.user.id, 'totp.enrolled');
      return { ok: true };
    }),

  stepUp: protectedProcedure
    .input(z.object({ code: totpCodeSchema }))
    .mutation(async ({ ctx, input }) => {
      if (!isAdminUser(ctx.user, ctx.env.ADMIN_PUBLIC_KEY)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not an admin' });
      }
      if (isTotpRequired(ctx.env)) {
        if (!ctx.user.totpSecret) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'TOTP not enrolled' });
        }
        const now = new Date();
        const [throttle] = await ctx.db
          .select()
          .from(adminStepUpAttempts)
          .where(eq(adminStepUpAttempts.userId, ctx.user.id))
          .limit(1);
        if (throttle && isLocked(throttle.lockedUntil, now)) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Too many failed attempts' });
        }
        const secret = await decryptTotpSecret(ctx.user.totpSecret, ctx.env.ADMIN_TOTP_ENC_KEY);
        if (!verifyTotpCode(secret, input.code)) {
          const next = nextThrottleState(
            { failedAttempts: throttle?.failedAttempts ?? 0, lockedUntil: throttle?.lockedUntil ?? null },
            now,
          );
          if (throttle) {
            await ctx.db
              .update(adminStepUpAttempts)
              .set({ failedAttempts: next.failedAttempts, lockedUntil: next.lockedUntil, updatedAt: now })
              .where(eq(adminStepUpAttempts.userId, ctx.user.id));
          } else {
            await ctx.db.insert(adminStepUpAttempts).values({
              userId: ctx.user.id,
              failedAttempts: next.failedAttempts,
              lockedUntil: next.lockedUntil,
              updatedAt: now,
            });
          }
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid TOTP code' });
        }
        if (throttle) {
          await ctx.db
            .update(adminStepUpAttempts)
            .set({ ...resetThrottle(), updatedAt: now })
            .where(eq(adminStepUpAttempts.userId, ctx.user.id));
        }
      }
      await logAdminAction(ctx.db, ctx.user.id, 'admin.login');
      const token = await issueAdminToken({
        secret: ctx.env.ADMIN_JWT_SECRET,
        userId: ctx.user.id,
        jti: crypto.randomUUID(),
      });
      return { token };
    }),

  promote: adminProcedure
    .input(z.object({ publicKey: stellarAccountIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const [target] = await ctx.db.select().from(users).where(eq(users.stellarPublicKey, input.publicKey)).limit(1);
      const guard = canPromote(target);
      if (!guard.ok) {
        const message = guard.code === 'NOT_FOUND' ? 'Account not found' : 'Account is already an admin';
        throw new TRPCError({ code: guard.code, message });
      }
      await ctx.db.update(users).set({ role: 'admin' }).where(eq(users.id, guard.target.id));
      await logAdminAction(ctx.db, ctx.admin.id, 'promote', input.publicKey);
      return { ok: true };
    }),

  demote: adminProcedure
    .input(z.object({ publicKey: stellarAccountIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const [target] = await ctx.db.select().from(users).where(eq(users.stellarPublicKey, input.publicKey)).limit(1);
      const guard = canDemote(target, ctx.admin.id);
      if (!guard.ok) {
        const messages = {
          NOT_FOUND: 'Account not found',
          CONFLICT: 'Account is not an admin',
          FORBIDDEN: 'Cannot demote yourself',
        } as const;
        throw new TRPCError({ code: guard.code, message: messages[guard.code] });
      }
      await ctx.db.update(users).set({ role: 'user' }).where(eq(users.id, guard.target.id));
      await logAdminAction(ctx.db, ctx.admin.id, 'demote', input.publicKey);
      return { ok: true };
    }),

  listAdmins: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.select().from(users).where(eq(users.role, 'admin'));
    return {
      admins: rows.map((row) => ({
        id: row.id,
        stellarPublicKey: row.stellarPublicKey,
        email: row.email,
        displayName: row.displayName,
      })),
    };
  }),

  listShops: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ shop: coffeeShops, owner: users })
      .from(coffeeShops)
      .leftJoin(users, eq(coffeeShops.ownerUserId, users.id));
    return {
      shops: rows.map((row) => ({
        id: row.shop.id,
        name: row.shop.name,
        address: row.shop.address,
        isActive: row.shop.isActive,
        ownerPublicKey: row.owner?.stellarPublicKey ?? null,
      })),
    };
  }),

  createShop: adminProcedure.input(createShopInput).mutation(async ({ ctx, input }) => {
    const ownerUserId = await resolveOwnerUserId(ctx.db, input.ownerPublicKey);
    const [shop] = await ctx.db
      .insert(coffeeShops)
      .values({
        name: input.name,
        address: input.address ?? null,
        ownerUserId: ownerUserId ?? null,
        createdAt: new Date(),
      })
      .returning();
    if (!shop) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create coffee shop' });
    }
    await logAdminAction(ctx.db, ctx.admin.id, 'shop.create', String(shop.id));
    return {
      shop: {
        id: shop.id,
        name: shop.name,
        address: shop.address,
        isActive: shop.isActive,
        ownerPublicKey: input.ownerPublicKey ?? null,
      },
    };
  }),

  updateShop: adminProcedure.input(updateShopInput).mutation(async ({ ctx, input }) => {
    const [shop] = await ctx.db.select().from(coffeeShops).where(eq(coffeeShops.id, input.id)).limit(1);
    if (!shop) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Coffee shop not found' });
    }
    const ownerUserId = await resolveOwnerUserId(ctx.db, input.ownerPublicKey);
    const updates: Partial<typeof coffeeShops.$inferInsert> = {};
    if (input.name !== undefined) updates.name = input.name;
    if (input.address !== undefined) updates.address = input.address === '' ? null : input.address;
    if (input.isActive !== undefined) updates.isActive = input.isActive;
    if (ownerUserId !== undefined) updates.ownerUserId = ownerUserId;
    await ctx.db.update(coffeeShops).set(updates).where(eq(coffeeShops.id, input.id));
    await logAdminAction(ctx.db, ctx.admin.id, 'shop.update', String(input.id));
    return { ok: true };
  }),

  disableShop: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const [shop] = await ctx.db.select().from(coffeeShops).where(eq(coffeeShops.id, input.id)).limit(1);
      if (!shop) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Coffee shop not found' });
      }
      await ctx.db.update(coffeeShops).set({ isActive: false }).where(eq(coffeeShops.id, input.id));
      await logAdminAction(ctx.db, ctx.admin.id, 'shop.disable', String(input.id));
      return { ok: true };
    }),
});
