import { and, eq, like, ne, or } from 'drizzle-orm';
import { users } from '@takapp/shared/db';
import { updateProfileSchema, userSearchSchema } from '@takapp/shared/zod-schemas';
import { protectedProcedure, router } from '../trpc';

const SEARCH_LIMIT = 10;

export const usersRouter = router({
  me: protectedProcedure.query(async ({ ctx }) => ({
    publicKey: ctx.user.stellarPublicKey,
    email: ctx.user.email,
    phone: ctx.user.phone,
    displayName: ctx.user.displayName,
    role: ctx.user.role,
  })),

  updateProfile: protectedProcedure.input(updateProfileSchema).mutation(async ({ ctx, input }) => {
    await ctx.db.update(users).set({ displayName: input.displayName }).where(eq(users.id, ctx.user.id));
    return { publicKey: ctx.user.stellarPublicKey, displayName: input.displayName };
  }),

  search: protectedProcedure.input(userSearchSchema).query(async ({ ctx, input }) => {
    const query = input.query.trim();
    if (query.length === 0) return { results: [] };
    const rows = await ctx.db
      .select()
      .from(users)
      .where(
        and(
          ne(users.stellarPublicKey, ctx.user.stellarPublicKey),
          or(like(users.displayName, `%${query}%`), like(users.stellarPublicKey, `${query}%`)),
        ),
      )
      .limit(SEARCH_LIMIT);
    return {
      results: rows.map((row) => ({ publicKey: row.stellarPublicKey, displayName: row.displayName })),
    };
  }),
});
