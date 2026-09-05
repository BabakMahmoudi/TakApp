import { Agent } from 'agents';
import type { AgentEnv } from '../env';
import { createDataAccess } from '../db';
import { buildSystemPrompt } from '../prompt';
import {
  createChatClient,
  runChatTurn,
  type ChatMessage,
  type ToolCall,
} from '../llm/deepseek';
import { runTool, toolDefinitions, type ToolContext } from '../tools';

const MAX_TOOL_ROUNDS = 4;
const SSE_ERROR_MESSAGE = 'Sorry, something went wrong on my side. Please try again.';

export type TakAppState = Record<string, never>;

interface MessageRow {
  role: string;
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
}

export class TakAppAgent extends Agent<AgentEnv, TakAppState> {
  initialState: TakAppState = {};

  async onRequest(request: Request): Promise<Response> {
    const body = (await request.json()) as { message?: unknown };
    const raw = typeof body?.message === 'string' ? body.message : '';
    const message = raw.trim();
    if (!message) {
      return new Response('{"error":"message is required"}', {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const publicKey = request.headers.get('x-agent-user');
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const send = (event: Record<string, unknown>): void => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        try {
          await this.runConversation(send, message, publicKey);
          send({ type: 'done' });
        } catch (error) {
          console.error('[agent] chat error', error);
          send({ type: 'error', message: SSE_ERROR_MESSAGE });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    });
  }

  private ensureSchema(): void {
    this.sql`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls TEXT,
      tool_call_id TEXT,
      created_at INTEGER NOT NULL
    )`;
  }

  private loadMessages(): ChatMessage[] {
    this.ensureSchema();
    const rows = this.sql<MessageRow>`SELECT role, content, tool_calls, tool_call_id FROM messages ORDER BY id ASC`;
    const messages: ChatMessage[] = [];
    for (const row of rows) {
      if (row.role === 'user') {
        messages.push({ role: 'user', content: row.content });
      } else if (row.role === 'assistant') {
        messages.push({ role: 'assistant', content: row.content, toolCalls: parseToolCalls(row.tool_calls) });
      } else if (row.role === 'tool') {
        messages.push({ role: 'tool', content: row.content, toolCallId: row.tool_call_id ?? '' });
      }
    }
    return messages;
  }

  private appendUserMessage(content: string): void {
    this.sql`INSERT INTO messages (role, content, created_at) VALUES ('user', ${content}, ${Date.now()})`;
  }

  private appendAssistantMessage(content: string, toolCalls?: ToolCall[]): void {
    const json = toolCalls && toolCalls.length > 0 ? JSON.stringify(toolCalls) : null;
    this.sql`INSERT INTO messages (role, content, tool_calls, created_at) VALUES ('assistant', ${content}, ${json}, ${Date.now()})`;
  }

  private appendToolMessage(toolCallId: string, content: string): void {
    this.sql`INSERT INTO messages (role, content, tool_call_id, created_at) VALUES ('tool', ${content}, ${toolCallId}, ${Date.now()})`;
  }

  private async runConversation(
    send: (event: Record<string, unknown>) => void,
    message: string,
    publicKey: string | null,
  ): Promise<void> {
    const history = this.loadMessages();
    this.appendUserMessage(message);

    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(this.env.TAK_CONTRACT_ID) },
      ...history,
      { role: 'user', content: message },
    ];

    const client = createChatClient(this.env);
    const toolContext: ToolContext = {
      env: this.env,
      data: createDataAccess(this.env),
      publicKey,
    };

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const turn = await runChatTurn(client, messages, toolDefinitions, (delta) =>
        send({ type: 'token', content: delta }),
      );

      if (turn.toolCalls.length === 0) {
        if (turn.content) this.appendAssistantMessage(turn.content);
        break;
      }

      this.appendAssistantMessage(turn.content, turn.toolCalls);
      messages.push({ role: 'assistant', content: turn.content, toolCalls: turn.toolCalls });

      for (const call of turn.toolCalls) {
        send({ type: 'tool', name: call.name });
        let result: string;
        try {
          result = await runTool(call.name, call.arguments, toolContext);
        } catch (error) {
          console.error('[agent] tool error', call.name, error);
          result = `Tool "${call.name}" could not complete right now.`;
        }
        this.appendToolMessage(call.id, result);
        messages.push({ role: 'tool', content: result, toolCallId: call.id });
      }
    }
  }
}

function parseToolCalls(json: string | null): ToolCall[] | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return parsed as ToolCall[];
  } catch {
    return undefined;
  }
}
