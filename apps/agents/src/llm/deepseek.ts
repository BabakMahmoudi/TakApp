import OpenAI from 'openai';
import type { AgentEnv } from '../env';

export const CHAT_MODEL = 'deepseek-v4-flash';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string };

export function createChatClient(env: AgentEnv): OpenAI {
  return new OpenAI({
    apiKey: env.DEEPSEEK_API_KEY,
    baseURL: env.DEEPSEEK_BASE_URL,
  });
}

function toOpenAiMessages(
  messages: ChatMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((message): OpenAI.Chat.Completions.ChatCompletionMessageParam => {
    switch (message.role) {
      case 'system':
        return { role: 'system', content: message.content };
      case 'user':
        return { role: 'user', content: message.content };
      case 'assistant':
        return {
          role: 'assistant',
          content: message.content,
          ...(message.toolCalls && message.toolCalls.length > 0
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: 'function' as const,
                  function: { name: call.name, arguments: call.arguments },
                })),
              }
            : {}),
        };
      case 'tool':
        return { role: 'tool', content: message.content, tool_call_id: message.toolCallId };
    }
  });
}

export interface ChatTurnResult {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string;
}

export async function runChatTurn(
  client: OpenAI,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  onToken: (delta: string) => void,
): Promise<ChatTurnResult> {
  const stream = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages: toOpenAiMessages(messages),
    tools: tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    })),
    tool_choice: 'auto',
    stream: true,
  });

  let content = '';
  const toolCalls: ToolCall[] = [];
  let finishReason = 'stop';

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;
    const delta = choice.delta;
    if (delta?.content) {
      content += delta.content;
      onToken(delta.content);
    }
    if (delta?.tool_calls) {
      for (const deltaCall of delta.tool_calls) {
        const index = deltaCall.index;
        let call = toolCalls[index];
        if (!call) {
          call = { id: '', name: '', arguments: '' };
          toolCalls[index] = call;
        }
        if (deltaCall.id) call.id = deltaCall.id;
        if (deltaCall.function?.name) call.name = deltaCall.function.name;
        if (deltaCall.function?.arguments) call.arguments += deltaCall.function.arguments;
      }
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }

  return { content, toolCalls, finishReason };
}
