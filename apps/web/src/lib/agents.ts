import { getAnonymousKey, getSessionToken } from './storage';

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentStreamCallbacks {
  onToken?: (delta: string) => void;
  onTool?: (name: string) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

interface StreamEvent {
  type: string;
  content?: string;
  name?: string;
  message?: string;
}

export async function streamAgentChat(
  agentId: string,
  memoryId: string,
  message: string,
  callbacks: AgentStreamCallbacks,
): Promise<void> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = getSessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const anonymousKey = getAnonymousKey();
  if (anonymousKey) headers['x-anonymous-key'] = anonymousKey;

  const response = await fetch(`/api/agents/${agentId}/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ memoryId, message }),
  });

  if (!response.ok) {
    let messageText = 'request_failed';
    try {
      const data = (await response.json()) as { error?: string; message?: string };
      messageText = data.message ?? data.error ?? messageText;
    } catch {
      // non-JSON error body; keep the generic message
    }
    callbacks.onError?.(messageText);
    return;
  }

  if (!response.body) {
    callbacks.onError?.('empty_response');
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      dispatchEvent(raw, callbacks);
      boundary = buffer.indexOf('\n\n');
    }
  }

  callbacks.onDone?.();
}

function dispatchEvent(raw: string, callbacks: AgentStreamCallbacks): void {
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    let event: StreamEvent;
    try {
      event = JSON.parse(line.slice('data: '.length)) as StreamEvent;
    } catch {
      continue;
    }
    switch (event.type) {
      case 'token':
        if (typeof event.content === 'string') callbacks.onToken?.(event.content);
        break;
      case 'tool':
        if (typeof event.name === 'string') callbacks.onTool?.(event.name);
        break;
      case 'error':
        callbacks.onError?.(typeof event.message === 'string' ? event.message : 'unknown_error');
        break;
      default:
        break;
    }
  }
}
