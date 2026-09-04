import { nativeToScVal } from '@stellar/stellar-sdk/no-axios';
import { describe, expect, it } from 'vitest';
import {
  fetchBalances,
  type HorizonServer,
  type SorobanRpcServer,
} from '../src/server/stellar/horizon';

const PUBLIC_KEY = 'GA3TUENLY64HLO5ED4W3IF2BVO4X5LCJTPBB77MYWR5QJSBR3CAXNR3V';
const TAK_CONTRACT_ID = 'CBI3WR5NQZUQ5PAPV4TBCOFMJ3MOJVZVMH5CKCGVOP63YV2SPFZN3Z7C';

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
    getContractData: async () => ({
      val: {
        contractData: () => ({
          val: () => nativeToScVal(rawRetval, { type: 'i128' }),
        }),
      },
    }),
  } as unknown as SorobanRpcServer;
}

describe('fetchBalances', () => {
  it('reads TAK from the SEP-41 Balance ledger entry and native XLM', async () => {
    const server = makeServer(makeAccount([{ asset_type: 'native', balance: '5' }]));
    const rpc = makeRpc(50_000_000_000n);

    const balances = await fetchBalances(server, rpc, PUBLIC_KEY, TAK_CONTRACT_ID);

    expect(balances).toEqual([
      { asset: 'XLM', stroops: '50000000' },
      { asset: 'TAK', stroops: '50000000000' },
    ]);
  });

  it('returns a zero TAK entry when the contract balance is zero', async () => {
    const server = makeServer(makeAccount([{ asset_type: 'native', balance: '1' }]));
    const rpc = makeRpc(0n);

    const balances = await fetchBalances(server, rpc, PUBLIC_KEY, TAK_CONTRACT_ID);

    expect(balances).toEqual([
      { asset: 'XLM', stroops: '10000000' },
      { asset: 'TAK', stroops: '0' },
    ]);
  });

  it('degrades TAK to zero (keeping XLM) when the RPC read fails', async () => {
    const server = makeServer(makeAccount([{ asset_type: 'native', balance: '1' }]));
    const rpc = {
      getContractData: async () => {
        throw new Error('not found');
      },
    } as unknown as SorobanRpcServer;

    const balances = await fetchBalances(server, rpc, PUBLIC_KEY, TAK_CONTRACT_ID);

    expect(balances).toEqual([
      { asset: 'XLM', stroops: '10000000' },
      { asset: 'TAK', stroops: '0' },
    ]);
  });
});
