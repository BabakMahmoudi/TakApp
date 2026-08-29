import { authRouter } from './routers/auth';
import { shopsRouter } from './routers/shops';
import { walletRouter } from './routers/wallet';
import { router } from './trpc';

export const appRouter = router({
  auth: authRouter,
  wallet: walletRouter,
  shops: shopsRouter,
});

export type AppRouter = typeof appRouter;
