import { describe, expect, it } from 'vitest';
import { buildCaller } from './helpers/caller';
import { MockDb } from './helpers/mock-db';

const PUBLIC_KEY = `G${'A'.repeat(55)}`;

describe('wallet.networkConfig', () => {
  it('returns same-origin proxy URLs when no override is set', async () => {
    const caller = await buildCaller(new MockDb({}), PUBLIC_KEY);
    const config = await caller.wallet.networkConfig();

    expect(config.horizonUrl).toBe('http://localhost/api/stellar/horizon');
    expect(config.sorobanRpcUrl).toBe('http://localhost/api/stellar/soroban');
    expect(config.networkPassphrase).toBe('Test SDF Network ; September 2015');
    expect(config.takToken).toEqual({
      code: 'TAK',
      contractId: 'CBI3WR5NQZUQ5PAPV4TBCOFMJ3MOJVZVMH5CKCGVOP63YV2SPFZN3Z7C',
      decimals: 7,
    });
  });

  it('returns the override URLs when set', async () => {
    const caller = await buildCaller(new MockDb({}), PUBLIC_KEY, {
      HORIZON_PUBLIC_URL: 'https://custom-horizon.example.com',
      SOROBAN_PUBLIC_RPC_URL: 'https://custom-rpc.example.com',
    });
    const config = await caller.wallet.networkConfig();

    expect(config.horizonUrl).toBe('https://custom-horizon.example.com');
    expect(config.sorobanRpcUrl).toBe('https://custom-rpc.example.com');
  });
});
