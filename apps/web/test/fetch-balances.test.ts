import { nativeToScVal } from '@stellar/stellar-sdk/no-axios';
import { describe, expect, it } from 'vitest';
import {
  fetchBalances,
  type HorizonServer,
  type SorobanRpcServer,
} from '../src/server/stellar/horizon';

const PUBLIC_KEY = 'GA3TUENLY64HLO5ED4W3IF2BVO4X5LCJTPBB77MYWR5QJSBR3CAXNR3V';
const TAK_CONTRACT_ID = 'CBI3WR5NQZUQ5PAPV4TBCOFMJ3MOJVZVMH5CKCGVOP63YV2SPFZN3Z7C';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

interface FakeAccount {
  accountId(): string;
  sequenceNumber(): string;
  incrementSequenceNumber(): void;
  balances: {
    asset_type: string;
    balance: string;
    asset_code?: string;
    asset_issuer?: string;
  }[];
}

function makeAccount(balances: FakeAccount['balances']): FakeAccount {
  return {
    accountId: () => PUBLIC_KEY,
    sequenceNumber: () => '1',
    incrementSequenceNumber: () => {},
    balances,
  };
}

function makeServer(account: FakeAccount): HorizonServer {
  return { loadAccount: async () => account } as unknown as HorizonServer;
}

function makeRpc(rawRetval: bigint): SorobanRpcServer {
  return {
    simulateTransaction: async () => ({
      result: { retval: nativeToScVal(rawRetval, { type: 'i128' }) },
    }),
  } as unknown as SorobanRpcServer;
}

describe('fetchBalances', () => {
  it('reads 5000 TAK from the SEP-41 contract and native XLM for GA3TUEN…', async () => {
    const server = makeServer(makeAccount([{ asset_type: 'native', balance: '5' }]));
    const rpc = makeRpc(50_000_000_000n);

    const balances = await fetchBalances(server, rpc, PUBLIC_KEY, TAK_CONTRACT_ID, NETWORK_PASSPHRASE);

    expect(balances).toEqual([
      { asset: 'XLM', stroops: '50000000' },
      { asset: 'TAK', stroops: '50000000000' },
    ]);
  });

  it('returns a zero TAK entry when the contract balance is zero', async () => {
    const server = makeServer(makeAccount([{ asset_type: 'native', balance: '1' }]));
    const rpc = makeRpc(0n);

    const balances = await fetchBalances(server, rpc, PUBLIC_KEY, TAK_CONTRACT_ID, NETWORK_PASSPHRASE);

    expect(balances).toEqual([
      { asset: 'XLM', stroops: '10000000' },
      { asset: 'TAK', stroops: '0' },
    ]);
  });

  it('propagates a Soroban simulation error', async () => {
    const server = makeServer(makeAccount([{ asset_type: 'native', balance: '1' }]));
    const rpc = {
      simulateTransaction: async () => ({ error: 'boom' }),
    } as unknown as SorobanRpcServer;

    await expect(
      fetchBalances(server, rpc, PUBLIC_KEY, TAK_CONTRACT_ID, NETWORK_PASSPHRASE),
    ).rejects.toThrow('TAK balance simulation failed: boom');
  });
});
