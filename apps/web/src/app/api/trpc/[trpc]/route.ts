import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { createContext } from '../../../../server/trpc/context';
import { appRouter } from '../../../../server/trpc/router';
import type { WorkerEnv } from '../../../../server/trpc/env';

const handler = (req: Request) => {
  const { env } = getCloudflareContext();
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: (opts) => createContext(opts, env as unknown as WorkerEnv),
  });
};

export { handler as GET, handler as POST };
