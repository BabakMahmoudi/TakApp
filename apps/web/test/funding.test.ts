import { Keypair } from '@stellar/stellar-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitCreateAccount, submitTakGift, type FundingServer } from '../src/server/stellar/funding';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

interface FakeAccount {
  accountId(): string;
  sequenceNumber(): string;
  incrementSequenceNumber(): void;
}

function fakeFundingAccount(publicKey: string): FakeAccount {
  let sequence = '1';
  return {
    accountId: () => publicKey,
    sequenceNumber: () => sequence,
    incrementSequenceNumber: () => {
      sequence = (BigInt(sequence) + 1n).toString();
    },
  };
}

function fakeServer(funding: Keypair): FundingServer {
  return {
    async loadAccount(publicKey: string) {
      expect(publicKey).toBe(funding.publicKey());
      return fakeFundingAccount(funding.publicKey());
    },
  } as unknown as FundingServer;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('account funding', () => {
  it('submits a createAccount transaction for the destination', async () => {
    const funding = Keypair.random();
    const destination = Keypair.random();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ hash: 'fake-hash' }, 200));
    vi.stubGlobal('fetch', fetchMock);
    const result = await submitCreateAccount(fakeServer(funding), {
      networkPassphrase: NETWORK_PASSPHRASE,
      fundingSecret: funding.secret(),
      destination: destination.publicKey(),
      horizonUrl: HORIZON_URL,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${HORIZON_URL}/transactions`,
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
    );
    expect(result).toEqual({ hash: 'fake-hash' });
  });

  it('throws the Horizon error body when the network rejects the transaction', async () => {
    const funding = Keypair.random();
    const destination = Keypair.random();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            type: 'https://stellar.org/horizon-errors/transaction_failed',
            title: 'Transaction Failed',
            status: 400,
            detail: 'The transaction failed when submitted to the network.',
            extras: { result_codes: { transaction: 'tx_failed', operations: ['op_underfunded'] } },
          },
          400,
        ),
      ),
    );
    await expect(
      submitCreateAccount(fakeServer(funding), {
        networkPassphrase: NETWORK_PASSPHRASE,
        fundingSecret: funding.secret(),
        destination: destination.publicKey(),
        horizonUrl: HORIZON_URL,
      }),
    ).rejects.toThrow(/op_underfunded/);
  });

  it('fails fast when Horizon is unreachable', async () => {
    const funding = Keypair.random();
    const destination = Keypair.random();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED horizon')));
    await expect(
      submitCreateAccount(fakeServer(funding), {
        networkPassphrase: NETWORK_PASSPHRASE,
        fundingSecret: funding.secret(),
        destination: destination.publicKey(),
        horizonUrl: HORIZON_URL,
      }),
    ).rejects.toThrow(/ECONNREFUSED horizon/);
  });
});

describe('TAK gift', () => {
  it('submits a 10 TAK payment to the destination', async () => {
    const funding = Keypair.random();
    const destination = Keypair.random();
    const takIssuer = Keypair.random().publicKey();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ hash: 'gift-hash' }, 200));
    vi.stubGlobal('fetch', fetchMock);
    const result = await submitTakGift(fakeServer(funding), {
      networkPassphrase: NETWORK_PASSPHRASE,
      fundingSecret: funding.secret(),
      takIssuer,
      destination: destination.publicKey(),
      horizonUrl: HORIZON_URL,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${HORIZON_URL}/transactions`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result).toEqual({ hash: 'gift-hash' });
  });

  it('surfaces Horizon rejection codes', async () => {
    const funding = Keypair.random();
    const destination = Keypair.random();
    const takIssuer = Keypair.random().publicKey();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            extras: { result_codes: { transaction: 'tx_failed', operations: ['op_no_trust'] } },
          },
          400,
        ),
      ),
    );
    await expect(
      submitTakGift(fakeServer(funding), {
        networkPassphrase: NETWORK_PASSPHRASE,
        fundingSecret: funding.secret(),
        takIssuer,
        destination: destination.publicKey(),
        horizonUrl: HORIZON_URL,
      }),
    ).rejects.toThrow(/op_no_trust/);
  });
});
