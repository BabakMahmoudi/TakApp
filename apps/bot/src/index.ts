import { webhookCallback } from 'grammy';
import { setupBot } from './bot';
import type { BotEnv } from './env';

export default {
  async fetch(request: Request, env: BotEnv): Promise<Response> {
    const bot = setupBot(env);
    return webhookCallback(bot, 'cloudflare-mod')(request);
  },
};
