import { Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { submitCreateAccount, type FundingServer } from '../src/server/stellar/funding';

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

describe('account funding', () => {
  it('submits a createAccount transaction for the destination', async () => {
    const funding = Keypair.random();
    const destination = Keypair.random();
    let submitted = false;
    const fakeServer = {
      async loadAccount(publicKey: string) {
        expect(publicKey).toBe(funding.publicKey());
        return fakeFundingAccount(funding.publicKey());
      },
      async submitTransaction(tx: unknown) {
        submitted = true;
        expect((tx as { _operations: { destination: string }[] })._operations?.[0]?.destination).toBe(
          destination.publicKey(),
        );
        return { hash: 'fake-hash' };
      },
    } as unknown as FundingServer;
    const result = await submitCreateAccount(fakeServer, {
      networkPassphrase: NETWORK_PASSPHRASE,
      fundingSecret: funding.secret(),
      destination: destination.publicKey(),
    });
    expect(submitted).toBe(true);
    expect(result).toEqual({ hash: 'fake-hash' });
  });

  it('fails when the funding account has insufficient balance', async () => {
    const funding = Keypair.random();
    const destination = Keypair.random();
    const fakeServer = {
      async loadAccount() {
        return fakeFundingAccount(funding.publicKey());
      },
      async submitTransaction() {
        throw new Error(
          'tx_failed: op_underfunded: Insufficient balance to fund account with this amount',
        );
      },
    } as unknown as FundingServer;
    await expect(
      submitCreateAccount(fakeServer, {
        networkPassphrase: NETWORK_PASSPHRASE,
        fundingSecret: funding.secret(),
        destination: destination.publicKey(),
      }),
    ).rejects.toThrow(/underfunded/);
  });
});
