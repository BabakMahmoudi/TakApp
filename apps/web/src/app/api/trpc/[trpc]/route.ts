import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { reqId, serializeError } from '../../../../server/logging';
import { createContext } from '../../../../server/trpc/context';
import { appRouter } from '../../../../server/trpc/router';
import type { WorkerEnv } from '../../../../server/trpc/env';

const handler = (req: Request) => {
  const { env } = getCloudflareContext();
  const rid = reqId();
  const started = Date.now();
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: (opts) => createContext(opts, env as unknown as WorkerEnv, rid),
    onError: ({ error, path }) => {
      console.error(
        `[trpc] ${error.code}${path ? ` ${path}` : ''} (${Date.now() - started}ms) reqId=${rid}: ${serializeError(error)}`,
      );
    },
  });
};

export { handler as GET, handler as POST };
