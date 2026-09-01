import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@takapp/shared/db';
import { buildCaller, errorCode, testEnv } from './helpers/caller';
import { MockDb, type MockDbTable } from './helpers/mock-db';

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: unknown, value: unknown) => ({ kind: 'eq', column, value }),
    ne: (column: unknown, value: unknown) => ({ kind: 'ne', column, value }),
    like: (column: unknown, value: unknown) => ({ kind: 'like', column, value }),
    and: (...conds: unknown[]) => ({ kind: 'and', conds }),
    or: (...conds: unknown[]) => ({ kind: 'or', conds }),
  };
});

vi.mock('../src/server/stellar/horizon', () => ({
  fetchBalances: vi.fn(),
  hasTrustline: vi.fn(),
}));

vi.mock('../src/server/stellar/funding', () => ({
  submitCreateAccount: vi.fn(),
  fundNewAccount: vi.fn(),
  submitTransactionToHorizon: vi.fn(),
  sendTakGift: vi.fn(),
}));

import { sendTakGift } from '../src/server/stellar/funding';
import { hasTrustline } from '../src/server/stellar/horizon';

const CALLER_KEY = `G${'A'.repeat(55)}`;

function makeCallerUser(): User {
  return {
    id: 1,
    stellarPublicKey: CALLER_KEY,
    email: 'caller@example.com',
    phone: null,
    displayName: null,
    passwordHash: 'pbkdf2$SHA-256$i=600000$abc$def',
    verificationState: 'unverified',
    role: 'user',
    totpSecret: null,
    createdAt: new Date(),
  };
}

function makeDb(giftRows: Record<string, unknown>[] = []) {
  const tables: Record<string, MockDbTable> = {
    users: { rows: [makeCallerUser()] },
    gifts: { rows: giftRows },
    coffee_shops: { rows: [] },
    payments: { rows: [], unique: ['txHash'] },
    sessions: { rows: [] },
    verifications: { rows: [] },
    telegram_bindings: { rows: [] },
    conversations: { rows: [] },
    admin_audit_log: { rows: [] },
    admin_step_up_attempts: { rows: [] },
  };
  return new MockDb(tables);
}

const sendTakGiftMock = vi.mocked(sendTakGift);
const hasTrustlineMock = vi.mocked(hasTrustline);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('wallet.claimGift', () => {
  it('issues the welcome gift once and records it', async () => {
    hasTrustlineMock.mockResolvedValue(true);
    sendTakGiftMock.mockResolvedValue({ hash: 'gift-hash' });
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);

    const result = await caller.wallet.claimGift();

    expect(result).toEqual({ amount: '100000000' });
    expect(sendTakGiftMock).toHaveBeenCalledWith({
      horizonUrl: testEnv.HORIZON_URL,
      networkPassphrase: testEnv.NETWORK_PASSPHRASE,
      fundingSecret: testEnv.FUNDING_SECRET,
      takIssuer: testEnv.TAK_ISSUER,
      destination: CALLER_KEY,
    });
    const rows = db.table('gifts').rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: 1, type: 'tak-welcome', amount: '100000000' });
  });

  it('rejects a second claim', async () => {
    hasTrustlineMock.mockResolvedValue(true);
    const db = makeDb([
      { id: 1, userId: 1, type: 'tak-welcome', amount: '100000000', createdAt: new Date() },
    ]);
    const caller = await buildCaller(db, CALLER_KEY);

    expect(await errorCode(caller.wallet.claimGift())).toBe('CONFLICT');
    expect(sendTakGiftMock).not.toHaveBeenCalled();
    expect(db.table('gifts').rows).toHaveLength(1);
  });

  it('rejects when the TAK trustline is missing', async () => {
    hasTrustlineMock.mockResolvedValue(false);
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);

    expect(await errorCode(caller.wallet.claimGift())).toBe('PRECONDITION_FAILED');
    expect(sendTakGiftMock).not.toHaveBeenCalled();
    expect(db.table('gifts').rows).toHaveLength(0);
  });

  it('does not record a gift when the funding send fails', async () => {
    hasTrustlineMock.mockResolvedValue(true);
    sendTakGiftMock.mockRejectedValue(new Error('TAK gift failed: op_underfunded'));
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);

    await expect(caller.wallet.claimGift()).rejects.toThrow(/op_underfunded/);
    expect(db.table('gifts').rows).toHaveLength(0);
  });
});


