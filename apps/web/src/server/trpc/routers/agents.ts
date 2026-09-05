import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { agentConversations } from '@takapp/shared/db';
import { agentIdSchema } from '@takapp/shared/zod-schemas';
import { resolveAgentOwner, type AgentOwner } from '../../agents/owner';
import { publicProcedure, router } from '../trpc';
import type { TrpcContext } from '../context';

export const agentsRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    const owner = await resolveAgentOwner(ctx.db, ctx.req, ctx.env.JWT_SECRET);
    const where =
      owner.kind === 'user'
        ? eq(agentConversations.userId, owner.userId)
        : owner.kind === 'anonymous'
          ? eq(agentConversations.anonymousKey, owner.anonymousKey)
          : null;
    if (!where) return { conversations: [] };
    const rows = await ctx.db
      .select()
      .from(agentConversations)
      .where(where)
      .orderBy(desc(agentConversations.lastMessageAt), desc(agentConversations.createdAt));
    const conversations = rows.map((row) => ({
      id: row.id,
      agentId: row.agentId,
      memoryId: row.memoryId,
      title: row.title,
      createdAt: row.createdAt,
      lastMessageAt: row.lastMessageAt,
    }));
    return { conversations };
  }),

  create: publicProcedure
    .input(z.object({ agentId: agentIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const owner = await resolveAgentOwner(ctx.db, ctx.req, ctx.env.JWT_SECRET);
      if (owner.kind === 'none') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Log in or provide a device id' });
      }
      const memoryId = crypto.randomUUID();
      const createdAt = new Date();
      const inserted = await ctx.db
        .insert(agentConversations)
        .values({
          userId: owner.kind === 'user' ? owner.userId : null,
          anonymousKey: owner.kind === 'anonymous' ? owner.anonymousKey : null,
          agentId: input.agentId,
          memoryId,
          title: null,
          createdAt,
          lastMessageAt: createdAt,
        })
        .returning({ id: agentConversations.id });
      const row = inserted[0];
      if (!row) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create conversation' });
      }
      return { id: row.id, memoryId, agentId: input.agentId };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const owner = await resolveAgentOwner(ctx.db, ctx.req, ctx.env.JWT_SECRET);
      const row = await findOwned(ctx, owner, input.id);
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found' });
      }
      await ctx.db.delete(agentConversations).where(eq(agentConversations.id, input.id));
      return { ok: true };
    }),

  rename: publicProcedure
    .input(z.object({ id: z.number().int().positive(), title: z.string().trim().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const owner = await resolveAgentOwner(ctx.db, ctx.req, ctx.env.JWT_SECRET);
      const row = await findOwned(ctx, owner, input.id);
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found' });
      }
      await ctx.db
        .update(agentConversations)
        .set({ title: input.title })
        .where(eq(agentConversations.id, input.id));
      return { ok: true };
    }),
});

async function findOwned(ctx: TrpcContext, owner: AgentOwner, id: number) {
  const where =
    owner.kind === 'user'
      ? and(eq(agentConversations.id, id), eq(agentConversations.userId, owner.userId))
      : owner.kind === 'anonymous'
        ? and(eq(agentConversations.id, id), eq(agentConversations.anonymousKey, owner.anonymousKey))
        : null;
  if (!where) return null;
  const [row] = await ctx.db.select().from(agentConversations).where(where).limit(1);
  return row ?? null;
}
