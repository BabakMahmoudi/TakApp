import { Account, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { buildChallengeXdr, verifyChallengeXdr } from '../src/server/stellar/sep10';

const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const DOMAIN = 'takapp.dev';

function setup() {
  const server = Keypair.random();
  const client = Keypair.random();
  return { server, client };
}

describe('SEP-10 challenge', () => {
  it('accepts a challenge signed by the client key', () => {
    const { server, client } = setup();
    const challengeXdr = buildChallengeXdr({
      serverSecret: server.secret(),
      clientAccountId: client.publicKey(),
      networkPassphrase: NETWORK_PASSPHRASE,
      domainName: DOMAIN,
    });
    const tx = TransactionBuilder.fromXDR(challengeXdr, NETWORK_PASSPHRASE);
    tx.sign(client);
    expect(() =>
      verifyChallengeXdr({
        serverSecret: server.secret(),
        clientAccountId: client.publicKey(),
        networkPassphrase: NETWORK_PASSPHRASE,
        domainName: DOMAIN,
        signedXdr: tx.toXDR(),
      }),
    ).not.toThrow();
  });

  it('rejects a challenge signed by the wrong key', () => {
    const { server, client } = setup();
    const attacker = Keypair.random();
    const challengeXdr = buildChallengeXdr({
      serverSecret: server.secret(),
      clientAccountId: client.publicKey(),
      networkPassphrase: NETWORK_PASSPHRASE,
      domainName: DOMAIN,
    });
    const tx = TransactionBuilder.fromXDR(challengeXdr, NETWORK_PASSPHRASE);
    tx.sign(attacker);
    expect(() =>
      verifyChallengeXdr({
        serverSecret: server.secret(),
        clientAccountId: client.publicKey(),
        networkPassphrase: NETWORK_PASSPHRASE,
        domainName: DOMAIN,
        signedXdr: tx.toXDR(),
      }),
    ).toThrow();
  });

  it('rejects a tampered signed challenge', () => {
    const { server, client } = setup();
    const challengeXdr = buildChallengeXdr({
      serverSecret: server.secret(),
      clientAccountId: client.publicKey(),
      networkPassphrase: NETWORK_PASSPHRASE,
      domainName: DOMAIN,
    });
    const tx = TransactionBuilder.fromXDR(challengeXdr, NETWORK_PASSPHRASE);
    tx.sign(client);
    const tampered = tx.toXDR().slice(0, -2) + (tx.toXDR().endsWith('AA') ? 'AB' : 'AA');
    expect(() =>
      verifyChallengeXdr({
        serverSecret: server.secret(),
        clientAccountId: client.publicKey(),
        networkPassphrase: NETWORK_PASSPHRASE,
        domainName: DOMAIN,
        signedXdr: tampered,
      }),
    ).toThrow();
  });

  it('rejects an expired challenge', () => {
    const { server, client } = setup();
    const nonce = Buffer.from(`${DOMAIN} auth`).toString('base64');
    const tx = new TransactionBuilder(new Account(server.publicKey(), '1'), {
      fee: '100',
      networkPassphrase: NETWORK_PASSPHRASE,
      timebounds: { minTime: 0, maxTime: 1 },
    })
      .addOperation(Operation.manageData({ name: `${DOMAIN} auth`, value: nonce }))
      .build();
    tx.sign(server);
    tx.sign(client);
    expect(() =>
      verifyChallengeXdr({
        serverSecret: server.secret(),
        clientAccountId: client.publicKey(),
        networkPassphrase: NETWORK_PASSPHRASE,
        domainName: DOMAIN,
        signedXdr: tx.toXDR(),
      }),
    ).toThrow();
  });
});
