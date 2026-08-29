import { publicProcedure, router } from '../trpc';

export const shopsRouter = router({
  list: publicProcedure.query(async () => {
    // Placeholder: coffee-shop management is out of scaffold scope.
    return { shops: [] };
  }),
});
