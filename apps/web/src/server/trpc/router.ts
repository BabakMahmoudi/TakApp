import { adminRouter } from './routers/admin';
import { authRouter } from './routers/auth';
import { ownerRouter } from './routers/owner';
import { paymentsRouter } from './routers/payments';
import { shopsRouter } from './routers/shops';
import { usersRouter } from './routers/users';
import { walletRouter } from './routers/wallet';
import { router } from './trpc';

export const appRouter = router({
  auth: authRouter,
  wallet: walletRouter,
  shops: shopsRouter,
  users: usersRouter,
  payments: paymentsRouter,
  admin: adminRouter,
  owner: ownerRouter,
});

export type AppRouter = typeof appRouter;
