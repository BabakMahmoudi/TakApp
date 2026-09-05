import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '@takapp/shared/db';
import { agentConversations } from '@takapp/shared/db';
import { resolveAgentOwner } from './owner';
import type { WorkerEnv } from '../trpc/env';

const MAX_TITLE_LENGTH = 60;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function proxyAgentChat(
  req: Request,
  agentId: string,
  env: WorkerEnv,
): Promise<Response> {
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  let body: { memoryId?: unknown; message?: unknown };
  try {
    body = (await req.json()) as { memoryId?: unknown; message?: unknown };
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  const memoryId = typeof body.memoryId === 'string' ? body.memoryId : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!memoryId || !message) {
    return json(400, { error: 'memoryId and message are required' });
  }

  const db = drizzle(env.DB, { schema });
  const owner = await resolveAgentOwner(db, req, env.JWT_SECRET);

  const [conversation] = await db
    .select()
    .from(agentConversations)
    .where(eq(agentConversations.memoryId, memoryId))
    .limit(1);
  if (!conversation || conversation.agentId !== agentId) {
    return json(404, { error: 'conversation_not_found' });
  }

  const owned =
    owner.kind === 'user'
      ? conversation.userId === owner.userId
      : owner.kind === 'anonymous'
        ? conversation.anonymousKey === owner.anonymousKey
        : false;
  if (!owned) {
    return json(403, { error: 'forbidden' });
  }

  const now = new Date();
  await db
    .update(agentConversations)
    .set({ lastMessageAt: now, title: conversation.title ?? message.slice(0, MAX_TITLE_LENGTH) })
    .where(eq(agentConversations.id, conversation.id));

  const headers = new Headers();
  headers.set('content-type', 'application/json');
  headers.set('x-agent-memory-id', memoryId);
  headers.set('x-agent-internal-token', env.AGENTS_INTERNAL_TOKEN ?? '');
  if (owner.kind === 'user') {
    headers.set('x-agent-user', owner.publicKey);
  }

  const forwarded = new Request(`https://takapp-agents.internal/agents/${agentId}/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message }),
  });

  try {
    return await env.AGENTS.fetch(forwarded);
  } catch (error) {
    console.error('[agents] proxy error', error);
    return json(502, { error: 'bad_gateway' });
  }
}
