import type { D1Database } from '@cloudflare/workers-types';
import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import { describe, expect, it } from 'vitest';
import { setupBot } from '../src/bot';
import { createDataAccess, type BotDataAccess } from '../src/db';
import { BIND_PROMPT, handleBalance, handleHistory, handleShops } from '../src/intent/commands';
import type { BalanceEntry, BalanceReader } from '../src/stellar';
import type { BotEnv } from '../src/env';

const BOUND_TELEGRAM_ID = 111;
const UNBOUND_TELEGRAM_ID = 999;
const PUBLIC_KEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

function createFakeD1(): D1Database {
  const statement = {
    bind: () => statement,
    first: async () => null,
    all: async () => ({ results: [], success: true, meta: {} }),
    run: async () => ({ success: true, meta: {} }),
    raw: async () => [],
  };
  return {
    prepare: () => statement,
    batch: async () => [{ results: [], success: true, meta: {} }],
    exec: async () => ({ success: true, meta: {} }),
  } as unknown as D1Database;
}

function createEnv(): BotEnv {
  return {
    DB: createFakeD1(),
    BOT_TOKEN: '123456:test-token',
    DEEPSEEK_API_KEY: 'test',
    DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
    HORIZON_URL: 'https://horizon-testnet.stellar.org',
    NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
    TAK_ISSUER_PUBLIC_KEY: 'GD34LHPQRSZKJGTDSTAFHLTJ4AOS77JEAVMXVITLEI2XYCNSH64SIGRM',
    SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
    TAK_CONTRACT_ID: 'CBI3WR5NQZUQ5PAPV4TBCOFMJ3MOJVZVMH5CKCGVOP63YV2SPFZN3Z7C',
    APP_DOMAIN: 'takapp.dev',
  };
}

describe('read-only commands', () => {
  it('prompts an unbound user to link their wallet', async () => {
    const data = createDataAccess(createEnv());
    const balances: BalanceReader = { readBalances: async () => [] };
    await expect(handleBalance(data, balances, UNBOUND_TELEGRAM_ID)).resolves.toBe(BIND_PROMPT);
    await expect(handleShops(data, UNBOUND_TELEGRAM_ID)).resolves.toBe(BIND_PROMPT);
    await expect(handleHistory(data, UNBOUND_TELEGRAM_ID, 10)).resolves.toBe(BIND_PROMPT);
  });

  it('returns a stroop-string balance for a bound user', async () => {
    const data: BotDataAccess = {
      findUserByTelegramId: async (id: number) => {
        expect(id).toBe(BOUND_TELEGRAM_ID);
        return { publicKey: PUBLIC_KEY };
      },
      listShops: async () => [],
      listPayments: async () => [],
    };
    const balances: BalanceReader = {
      readBalances: async (publicKey: string): Promise<BalanceEntry[]> => {
        expect(publicKey).toBe(PUBLIC_KEY);
        return [
          { asset: 'XLM', stroops: '10000000' },
          { asset: 'TAK', stroops: '50000000' },
        ];
      },
    };
    const reply = await handleBalance(data, balances, BOUND_TELEGRAM_ID);
    expect(reply).toContain('XLM: 1');
    expect(reply).toContain('TAK: 5');
  });
});

describe('bot handler', () => {
  async function captureReplies(bot: Bot, update: Update): Promise<string[]> {
    const replies: string[] = [];
    bot.api.config.use(async (_prev, method, payload) => {
      if (method === 'getMe') {
        return {
          ok: true,
          result: { id: 1, is_bot: true, first_name: 'TakApp', username: 'takapp_bot' },
        } as never;
      }
      if (method === 'sendMessage') {
        replies.push((payload as { text?: string }).text ?? '');
      }
      return { ok: true, result: { message_id: 1 } } as never;
    });
    await bot.init();
    await bot.handleUpdate(update);
    return replies;
  }

  function updateWithText(text: string): Update {
    return {
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: UNBOUND_TELEGRAM_ID, is_bot: false, first_name: 'Test' },
        chat: { id: UNBOUND_TELEGRAM_ID, type: 'private', first_name: 'Test' },
        date: 1_700_000_000,
        text,
        entities: [{ offset: 0, length: text.length, type: 'bot_command' }],
      },
    };
  }

  it('responds to /ping', async () => {
    const bot = setupBot(createEnv());
    await expect(captureReplies(bot, updateWithText('/ping'))).resolves.toEqual(['pong']);
  });

  it('responds to /start', async () => {
    const bot = setupBot(createEnv());
    const replies = await captureReplies(bot, updateWithText('/start'));
    expect(replies[0]).toContain('Welcome to TakApp');
  });

  it('responds to /balance with a bind prompt for unbound users', async () => {
    const bot = setupBot(createEnv());
    const replies = await captureReplies(bot, updateWithText('/balance'));
    expect(replies).toEqual([BIND_PROMPT]);
  });
});
