import type { AgentEnv } from './env';
import { AGENT_CATALOG } from './catalog';

export { TakAppAgent } from './agents/takapp-agent';

export default {
  async fetch(request: Request, env: AgentEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response('ok', { status: 200 });
    }

    if (!isInternalRequest(request, env)) {
      return new Response('Forbidden', { status: 403 });
    }

    const match = /^\/agents\/([^/]+)\/chat$/.exec(url.pathname);
    if (!match) {
      return new Response('Not found', { status: 404 });
    }

    const agentId = match[1];
    if (!agentId) {
      return new Response('Not found', { status: 404 });
    }
    const entry = AGENT_CATALOG[agentId];
    if (!entry) {
      return new Response('Unknown agent', { status: 404 });
    }
    if (!entry.binding) {
      return new Response('Agent not available yet', { status: 501 });
    }

    const memoryId = request.headers.get('x-agent-memory-id');
    if (!memoryId) {
      return new Response('Missing memory id', { status: 400 });
    }

    const namespace = env[entry.binding];
    const stub = namespace.get(namespace.idFromName(memoryId));
    return stub.fetch(request);
  },
};

function isInternalRequest(request: Request, env: AgentEnv): boolean {
  const expected = env.AGENTS_INTERNAL_TOKEN;
  if (!expected) return true;
  return request.headers.get('x-agent-internal-token') === expected;
}
