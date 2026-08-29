import { Bot, type BotConfig, type Context } from 'grammy';
import type { BotEnv } from './env';
import { createDataAccess } from './db';
import { createBalanceReader } from './stellar';
import { handleBalance, handleHistory, handleShops } from './intent/commands';
import { parseUserRequest } from './llm/deepseek';

export function setupBot(env: BotEnv, config?: BotConfig<Context>): Bot {
  const bot = new Bot(env.BOT_TOKEN, config);
  const data = createDataAccess(env);
  const balances = createBalanceReader(env);

  bot.command('start', async (ctx) => {
    await ctx.reply('Welcome to TakApp. Ask me things like "show my balance" or "where can I pay?".');
  });

  bot.command('ping', async (ctx) => {
    await ctx.reply('pong');
  });

  bot.command('balance', async (ctx) => {
    await ctx.reply(await handleBalance(data, balances, ctx.from?.id ?? 0));
  });

  bot.on('message:text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    const telegramUserId = ctx.from?.id ?? 0;
    try {
      const intent = await parseUserRequest(env, ctx.message.text);
      const reply = await executeIntent(data, balances, telegramUserId, intent);
      await ctx.reply(reply);
    } catch {
      await ctx.reply('Sorry, I could not understand that. Try "show my balance" or "where can I pay?".');
    }
  });

  return bot;
}

async function executeIntent(
  data: ReturnType<typeof createDataAccess>,
  balances: ReturnType<typeof createBalanceReader>,
  telegramUserId: number,
  intent: Awaited<ReturnType<typeof parseUserRequest>>,
): Promise<string> {
  switch (intent.action) {
    case 'balance':
      return handleBalance(data, balances, telegramUserId);
    case 'shops':
      return handleShops(data, telegramUserId);
    case 'history':
      return handleHistory(data, telegramUserId, intent.limit ?? 10);
  }
}
