import { z } from 'zod';
import { finishGame, getGameHistory, listGames, startGame, withGameErrors } from '../../games/service';
import { protectedProcedure, router } from '../trpc';

export const gamesRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    withGameErrors(() => listGames(ctx.db, ctx.env)),
  ),

  start: protectedProcedure
    .input(z.object({ gameKey: z.string().min(1), feeTxHash: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      withGameErrors(() =>
        startGame(ctx.db, ctx.env, {
          userId: ctx.user.id,
          gameKey: input.gameKey,
          feeTxHash: input.feeTxHash,
        }),
      ),
    ),

  finish: protectedProcedure
    .input(z.object({ playId: z.number().int().positive(), performance: z.unknown() }))
    .mutation(({ ctx, input }) =>
      withGameErrors(() =>
        finishGame(ctx.db, ctx.env, {
          userId: ctx.user.id,
          playId: input.playId,
          performance: input.performance,
        }),
      ),
    ),

  history: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }))
    .query(({ ctx, input }) =>
      withGameErrors(() => getGameHistory(ctx.db, ctx.user.id, input.limit ?? 20)),
    ),
});
