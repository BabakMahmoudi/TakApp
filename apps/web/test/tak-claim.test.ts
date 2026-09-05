import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk/no-axios';
import type { TrpcContext } from '../src/server/trpc/context';
import { MockDb, type MockDbTable } from './helpers/mock-db';
import { fetchTakBalance } from '../src/server/stellar/horizon';
import { submitTakTransfer } from '../src/server/stellar/tak-transfer';
import {
  CLAIM_AMOUNT_STROOPS,
  CLAIM_TYPE,
  claimTak,
  getClaimStatus,
  TakFaucetError,
  toTrpcTakError,
} from '../src/server/tak/service';

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: unknown, value: unknown) => ({ kind: 'eq', column, value }),
    and: (...conds: unknown[]) => ({ kind: 'and', conds }),
  };
});

vi.mock('../src/server/stellar/horizon', () => ({
  fetchTakBalance: vi.fn(),
}));

vi.mock('../src/server/stellar/tak-transfer', () => ({
  submitTakTransfer: vi.fn(),
}));

const faucetKeypair = Keypair.random();
const USER_ID = 1;
const USER_PUBLIC_KEY = `G${'U'.repeat(55)}`;

function user() {
  return {
    id: USER_ID,
    stellarPublicKey: USER_PUBLIC_KEY,
    email: 'user@example.com',
    phone: null,
    displayName: 'User',
    passwordHash: 'pbkdf2$SHA-256$i=100000$abc$def',
    verificationState: 'verified',
    role: 'user',
    totpSecret: null,
    createdAt: new Date(),
  };
}

function gift(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: USER_ID,
    type: CLAIM_TYPE,
    amount: CLAIM_AMOUNT_STROOPS,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeDb(
  overrides: { gifts?: Record<string, unknown>[]; users?: Record<string, unknown>[] } = {},
) {
  const tables: Record<string, MockDbTable> = {
    users: { rows: overrides.users ?? [user()] },
    gifts: { rows: overrides.gifts ?? [] },
  };
  return new MockDb(tables);
}

function makeEnv(overrides: Partial<Parameters<typeof claimTak>[1]> = {}) {
  return {
    GAME_ACCOUNT_SECRET: faucetKeypair.secret(),
    HORIZON_URL: 'https://horizon-testnet.stellar.org',
    SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
    NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
    TAK_CONTRACT_ID: 'CBI3WR5NQZUQ5PAPV4TBCOFMJ3MOJVZVMH5CKCGVOP63YV2SPFZN3Z7C',
    ...overrides,
  };
}

function asDb(db: MockDb): TrpcContext['db'] {
  return db as unknown as TrpcContext['db'];
}

async function takErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof TakFaucetError ? error.code : undefined;
  }
}

describe('toTrpcTakError', () => {
  it('maps ALREADY_CLAIMED to NOT_FOUND and carries the typed code', () => {
    const error = toTrpcTakError(new TakFaucetError('claimed', 'ALREADY_CLAIMED'));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('ALREADY_CLAIMED');
  });

  it('maps FAUCET_OUT_OF_FUNDS to BAD_REQUEST', () => {
    const error = toTrpcTakError(new TakFaucetError('drained', 'FAUCET_OUT_OF_FUNDS'));
    expect(error.code).toBe('BAD_REQUEST');
    expect(error.message).toBe('FAUCET_OUT_OF_FUNDS');
  });

  it('maps CLAIM_FAILED to INTERNAL_SERVER_ERROR', () => {
    const error = toTrpcTakError(new TakFaucetError('boom', 'CLAIM_FAILED'));
    expect(error.code).toBe('INTERNAL_SERVER_ERROR');
  });
});

describe('getClaimStatus', () => {
  it('reports unclaimed when no gift row exists', async () => {
    const db = makeDb();
    const status = await getClaimStatus(asDb(db), USER_ID);
    expect(status).toEqual({ claimed: false, claimedAt: null, amount: null });
  });

  it('reports claimed with the amount and timestamp when a gift row exists', async () => {
    const db = makeDb({ gifts: [gift()] });
    const status = await getClaimStatus(asDb(db), USER_ID);
    expect(status.claimed).toBe(true);
    expect(status.amount).toBe(CLAIM_AMOUNT_STROOPS);
    expect(status.claimedAt).toBeInstanceOf(Date);
  });
});

describe('claimTak', () => {
  beforeEach(() => {
    vi.mocked(fetchTakBalance).mockReset();
    vi.mocked(fetchTakBalance).mockResolvedValue('100000000');
    vi.mocked(submitTakTransfer).mockReset();
    vi.mocked(submitTakTransfer).mockResolvedValue({ txHash: 'tx-hash', envelopeXdr: 'xdr' });
  });

  it('reserves, transfers, and returns the tx hash and amount', async () => {
    const db = makeDb();
    const result = await claimTak(asDb(db), makeEnv(), {
      userId: USER_ID,
      stellarPublicKey: USER_PUBLIC_KEY,
    });
    expect(result.amount).toBe(CLAIM_AMOUNT_STROOPS);
    expect(result.txHash).toBe('tx-hash');
    expect(submitTakTransfer).toHaveBeenCalledOnce();
    expect(submitTakTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSecret: faucetKeypair.secret(),
        destination: USER_PUBLIC_KEY,
        amountStroops: CLAIM_AMOUNT_STROOPS,
      }),
    );
    const rows = db.table('gifts').rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: USER_ID,
      type: CLAIM_TYPE,
      amount: CLAIM_AMOUNT_STROOPS,
    });
  });

  it('rejects an already claimed user without transferring', async () => {
    const db = makeDb({ gifts: [gift()] });
    const code = await takErrorCode(
      claimTak(asDb(db), makeEnv(), { userId: USER_ID, stellarPublicKey: USER_PUBLIC_KEY }),
    );
    expect(code).toBe('ALREADY_CLAIMED');
    expect(submitTakTransfer).not.toHaveBeenCalled();
  });

  it('rejects when the faucet secret is invalid', async () => {
    const db = makeDb();
    const code = await takErrorCode(
      claimTak(asDb(db), makeEnv({ GAME_ACCOUNT_SECRET: 'not-a-secret' }), {
        userId: USER_ID,
        stellarPublicKey: USER_PUBLIC_KEY,
      }),
    );
    expect(code).toBe('FAUCET_NOT_READY');
    expect(submitTakTransfer).not.toHaveBeenCalled();
  });

  it('rejects when the faucet cannot cover the claim', async () => {
    vi.mocked(fetchTakBalance).mockResolvedValue('29999999');
    const db = makeDb();
    const code = await takErrorCode(
      claimTak(asDb(db), makeEnv(), { userId: USER_ID, stellarPublicKey: USER_PUBLIC_KEY }),
    );
    expect(code).toBe('FAUCET_OUT_OF_FUNDS');
    expect(submitTakTransfer).not.toHaveBeenCalled();
  });

  it('deletes the reservation and throws CLAIM_FAILED when the transfer fails', async () => {
    vi.mocked(submitTakTransfer).mockRejectedValue(new Error('boom'));
    const db = makeDb();
    const code = await takErrorCode(
      claimTak(asDb(db), makeEnv(), { userId: USER_ID, stellarPublicKey: USER_PUBLIC_KEY }),
    );
    expect(code).toBe('CLAIM_FAILED');
    expect(db.table('gifts').rows).toHaveLength(0);
  });
});
