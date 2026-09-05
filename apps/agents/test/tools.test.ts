import { describe, expect, it } from 'vitest';
import type { AgentEnv } from '../src/env';
import type { AgentDataAccess } from '../src/db';
import { runTool, toolDefinitions, type ToolContext } from '../src/tools';

const CONTRACT_ID = 'CBI3WR5NQZUQ5PAPV4TBCOFMJ3MOJVZVMH5CKCGVOP63YV2SPFZN3Z7C';

function makeEnv(): AgentEnv {
  return {
    DB: {} as never,
    TakAppAgent: {} as never,
    DEEPSEEK_API_KEY: 'test',
    DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
    HORIZON_URL: 'https://horizon-testnet.stellar.org',
    NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
    SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
    TAK_CONTRACT_ID: CONTRACT_ID,
    APP_DOMAIN: 'takapp.dev',
    AGENTS_INTERNAL_TOKEN: 'test',
  };
}

function makeData(overrides: Partial<AgentDataAccess> = {}): AgentDataAccess {
  return {
    listShops: async () => [],
    getShopMenu: async () => [],
    listPayments: async () => [],
    listOrders: async () => [],
    ...overrides,
  };
}

function ctx(publicKey: string | null, data: AgentDataAccess = makeData()): ToolContext {
  return { env: makeEnv(), data, publicKey };
}

describe('agent tool registry', () => {
  it('exposes only read-only tools', () => {
    expect(toolDefinitions.map((tool) => tool.name)).toEqual([
      'listShops',
      'getShopMenu',
      'getTakTokenInfo',
      'getUserBalance',
      'getOrderHistory',
    ]);
  });
});

describe('runTool', () => {
  it('returns TAK token info without any auth', async () => {
    const result = await runTool('getTakTokenInfo', '{}', ctx(null));
    const parsed = JSON.parse(result) as { standard: string; contractId: string };
    expect(parsed.standard).toBe('SEP-41 (Soroban)');
    expect(parsed.contractId).toBe(CONTRACT_ID);
  });

  it('returns the shop menu from the data access layer', async () => {
    const data = makeData({ getShopMenu: async () => [{ name: 'Espresso', price: '10000000' }] });
    const result = await runTool('getShopMenu', '{"shopId":1}', ctx(null, data));
    const parsed = JSON.parse(result) as { name: string; priceTak: string }[];
    expect(parsed[0]).toMatchObject({ name: 'Espresso', priceTak: '1' });
  });

  it('refuses balance for anonymous users', async () => {
    await expect(runTool('getUserBalance', '{}', ctx(null))).resolves.toContain('Log in');
  });

  it('refuses order history for anonymous users', async () => {
    await expect(runTool('getOrderHistory', '{}', ctx(null))).resolves.toContain('Log in');
  });

  it('rejects malformed tool arguments', async () => {
    await expect(runTool('getShopMenu', 'not-json', ctx(null))).rejects.toThrow();
    await expect(runTool('getShopMenu', '{"shopId":"x"}', ctx(null))).rejects.toThrow();
  });

  it('returns a safe message for unknown tools', async () => {
    await expect(runTool('sendFunds', '{}', ctx(null))).resolves.toBe('Unknown tool: sendFunds');
  });
});
