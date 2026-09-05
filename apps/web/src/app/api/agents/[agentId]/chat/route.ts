import { getCloudflareContext } from '@opennextjs/cloudflare';
import { proxyAgentChat } from '../../../../../server/agents/proxy';
import type { WorkerEnv } from '../../../../../server/trpc/env';

type RouteContext = { params: Promise<{ agentId: string }> };

async function handle(req: Request, ctx: RouteContext): Promise<Response> {
  const { env } = getCloudflareContext();
  const { agentId } = await ctx.params;
  return proxyAgentChat(req, agentId, env as unknown as WorkerEnv);
}

export { handle as POST };
