import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrpcContext } from '../src/server/trpc/context';
import { buildCaller } from './helpers/caller';
import { MockDb, type MockDbTable } from './helpers/mock-db';
import {
  readTakBalanceCache,
  writeTakBalanceCache,
} from '../src/server/wallet/balance-cache';
import { fetchTakBalanceOnly } from '../src/server/stellar/horizon';

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: unknown, value: unknown) => ({ kind: 'eq', column, value }),
    and: (...conds: unknown[]) => ({ kind: 'and', conds }),
  };
});

vi.mock('../src/server/stellar/horizon', () => ({
  fetchTakBalanceOnly: vi.fn(),
  fetchBalances: vi.fn(),
}));

const CALLER_KEY = `G${'A'.repeat(55)}`;
const USER_ID = 1;

function makeDb(balanceRows: Record<string, unknown>[] = []) {
  const tables: Record<string, MockDbTable> = {
    users: {
      rows: [
        {
          id: USER_ID,
          stellarPublicKey: CALLER_KEY,
          email: 'caller@example.com',
          phone: null,
          displayName: null,
          passwordHash: 'pbkdf2$SHA-256$i=100000$abc$def',
          verificationState: 'verified',
          role: 'user',
          totpSecret: null,
          createdAt: new Date(),
        },
      ],
    },
    balance_cache: { rows: balanceRows, unique: ['userId'] },
  };
  return new MockDb(tables);
}

function asDb(db: MockDb): TrpcContext['db'] {
  return db as unknown as TrpcContext['db'];
}

describe('readTakBalanceCache', () => {
  it('returns null when no cache row exists', async () => {
    const db = makeDb();
    expect(await readTakBalanceCache(asDb(db), USER_ID)).toBeNull();
  });

  it('returns the cached stroops and timestamp', async () => {
    const updatedAt = new Date('2026-01-01T00:00:00Z');
    const db = makeDb([{ userId: USER_ID, takStroops: '50000000000', updatedAt }]);
    expect(await readTakBalanceCache(asDb(db), USER_ID)).toEqual({
      takStroops: '50000000000',
      updatedAt,
    });
  });
});

describe('writeTakBalanceCache', () => {
  it('inserts a new cache row', async () => {
    const db = makeDb();
    await writeTakBalanceCache(asDb(db), USER_ID, '70000000000');
    const rows = db.table('balance_cache').rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: USER_ID, takStroops: '70000000000' });
    expect(rows[0]?.updatedAt).toBeInstanceOf(Date);
  });

  it('updates an existing cache row instead of duplicating it', async () => {
    const db = makeDb([{ userId: USER_ID, takStroops: '10000000000', updatedAt: new Date() }]);
    await writeTakBalanceCache(asDb(db), USER_ID, '90000000000');
    const rows = db.table('balance_cache').rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: USER_ID, takStroops: '90000000000' });
  });
});

describe('wallet.takBalance', () => {
  beforeEach(() => {
    vi.mocked(fetchTakBalanceOnly).mockReset();
    vi.mocked(fetchTakBalanceOnly).mockResolvedValue('40000000000');
  });

  it('serves a cached balance without hitting the network', async () => {
    const updatedAt = new Date('2026-01-01T00:00:00Z');
    const db = makeDb([{ userId: USER_ID, takStroops: '50000000000', updatedAt }]);
    const caller = await buildCaller(db, CALLER_KEY);
    const result = await caller.wallet.takBalance();
    expect(result).toEqual({ takStroops: '50000000000', updatedAt: updatedAt.getTime(), source: 'cache' });
    expect(fetchTakBalanceOnly).not.toHaveBeenCalled();
  });

  it('fetches and persists when the cache is empty', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);
    const result = await caller.wallet.takBalance();
    expect(result.takStroops).toBe('40000000000');
    expect(result.source).toBe('network');
    expect(fetchTakBalanceOnly).toHaveBeenCalledOnce();
    expect(db.table('balance_cache').rows).toHaveLength(1);
    expect(db.table('balance_cache').rows[0]).toMatchObject({
      userId: USER_ID,
      takStroops: '40000000000',
    });
  });
});

describe('wallet.refreshTakBalance', () => {
  beforeEach(() => {
    vi.mocked(fetchTakBalanceOnly).mockReset();
    vi.mocked(fetchTakBalanceOnly).mockResolvedValue('60000000000');
  });

  it('always fetches from the network and updates the cache', async () => {
    const db = makeDb([{ userId: USER_ID, takStroops: '10000000000', updatedAt: new Date() }]);
    const caller = await buildCaller(db, CALLER_KEY);
    const result = await caller.wallet.refreshTakBalance();
    expect(result.takStroops).toBe('60000000000');
    expect(fetchTakBalanceOnly).toHaveBeenCalledOnce();
    expect(db.table('balance_cache').rows).toHaveLength(1);
    expect(db.table('balance_cache').rows[0]).toMatchObject({
      userId: USER_ID,
      takStroops: '60000000000',
    });
  });
});
