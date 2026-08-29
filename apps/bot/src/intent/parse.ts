import { intentSchema, type BotIntent } from '@takapp/shared/zod-schemas';

export const INTENT_SYSTEM_PROMPT = [
  'You translate a coffee-wallet user request into exactly one JSON object.',
  'Allowed intents:',
  '- {"action":"balance","asset":"XLM"|"TAK"} (asset is optional)',
  '- {"action":"shops"}',
  '- {"action":"history","limit":number} (limit optional, 1-50)',
  'Never invent data. Reply with a single JSON object and nothing else.',
].join('\n');

export function parseIntentJson(content: string): BotIntent {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    throw new Error('LLM returned non-JSON output');
  }
  const parsed = intentSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error('LLM returned an invalid or unsupported intent');
  }
  return parsed.data;
}
