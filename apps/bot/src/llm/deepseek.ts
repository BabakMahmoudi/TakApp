import OpenAI from 'openai';
import type { BotIntent } from '@takapp/shared/zod-schemas';
import type { BotEnv } from '../env';
import { INTENT_SYSTEM_PROMPT, parseIntentJson } from '../intent/parse';

export async function parseUserRequest(env: BotEnv, text: string): Promise<BotIntent> {
  const client = new OpenAI({
    apiKey: env.DEEPSEEK_API_KEY,
    baseURL: env.DEEPSEEK_BASE_URL,
  });
  const completion = await client.chat.completions.create({
    model: 'deepseek-chat',
    temperature: 0,
    max_tokens: 120,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: INTENT_SYSTEM_PROMPT },
      { role: 'user', content: text },
    ],
  });
  const content = completion.choices[0]?.message?.content ?? '';
  return parseIntentJson(content);
}
