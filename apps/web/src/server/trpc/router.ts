import { adminRouter } from './routers/admin';
import { agentsRouter } from './routers/agents';
import { authRouter } from './routers/auth';
import { gamesRouter } from './routers/games';
import { ordersRouter } from './routers/orders';
import { ownerRouter } from './routers/owner';
import { paymentsRouter } from './routers/payments';
import { pushRouter } from './routers/push';
import { shopsRouter } from './routers/shops';
import { takRouter } from './routers/tak';
import { usersRouter } from './routers/users';
import { walletRouter } from './routers/wallet';
import { router } from './trpc';

export const appRouter = router({
  auth: authRouter,
  wallet: walletRouter,
  shops: shopsRouter,
  users: usersRouter,
  payments: paymentsRouter,
  games: gamesRouter,
  tak: takRouter,
  admin: adminRouter,
  owner: ownerRouter,
  orders: ordersRouter,
  push: pushRouter,
  agents: agentsRouter,
});

export type AppRouter = typeof appRouter;
