import { getCloudflareContext } from '@opennextjs/cloudflare';
import { proxyStellarRequest } from '../../../../server/stellar/proxy';
import type { WorkerEnv } from '../../../../server/trpc/env';

type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(req: Request, ctx: RouteContext): Promise<Response> {
  const { env } = getCloudflareContext();
  const { path } = await ctx.params;
  return proxyStellarRequest(req, path, env as unknown as WorkerEnv);
}

export { handle as GET, handle as POST };
