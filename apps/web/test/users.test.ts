import { describe, expect, it, vi } from 'vitest';
import type { User } from '@takapp/shared/db';
import { buildCaller, errorCode } from './helpers/caller';
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

const CALLER_KEY = `G${'A'.repeat(55)}`;

function user(id: number, publicKey: string, displayName: string | null): User {
  return {
    id,
    stellarPublicKey: publicKey,
    email: `user${id}@example.com`,
    phone: null,
    displayName,
    passwordHash: 'pbkdf2$SHA-256$i=100000$abc$def',
    verificationState: 'unverified',
    role: 'user',
    totpSecret: null,
    createdAt: new Date(),
  };
}

function makeDb(userRows: User[] = []) {
  const tables: Record<string, MockDbTable> = {
    users: { rows: userRows },
    coffee_shops: { rows: [] },
    payments: { rows: [], unique: ['txHash'] },
    sessions: { rows: [] },
    gifts: { rows: [] },
    verifications: { rows: [] },
    telegram_bindings: { rows: [] },
    conversations: { rows: [] },
    admin_audit_log: { rows: [] },
    admin_step_up_attempts: { rows: [] },
  };
  return new MockDb(tables);
}

describe('users.me', () => {
  it('returns the caller profile', async () => {
    const db = makeDb([user(1, CALLER_KEY, 'Caller')]);
    const caller = await buildCaller(db, CALLER_KEY);
    const me = await caller.users.me();
    expect(me).toMatchObject({ publicKey: CALLER_KEY, displayName: 'Caller', role: 'user' });
    expect(me.email).toBe('user1@example.com');
  });
});

describe('users.updateProfile', () => {
  it('updates the display name', async () => {
    const db = makeDb([user(1, CALLER_KEY, 'Old Name')]);
    const caller = await buildCaller(db, CALLER_KEY);
    const result = await caller.users.updateProfile({ displayName: '  New Name  ' });
    expect(result).toEqual({ publicKey: CALLER_KEY, displayName: 'New Name' });
    expect(db.table('users').rows[0]!.displayName).toBe('New Name');
  });

  it('rejects an empty display name', async () => {
    const db = makeDb([user(1, CALLER_KEY, 'Caller')]);
    const caller = await buildCaller(db, CALLER_KEY);
    expect(await errorCode(caller.users.updateProfile({ displayName: '' }))).toBe('BAD_REQUEST');
  });

  it('rejects a whitespace-only display name', async () => {
    const db = makeDb([user(1, CALLER_KEY, 'Caller')]);
    const caller = await buildCaller(db, CALLER_KEY);
    expect(await errorCode(caller.users.updateProfile({ displayName: '   ' }))).toBe('BAD_REQUEST');
  });

  it('rejects a display name longer than 50 characters', async () => {
    const db = makeDb([user(1, CALLER_KEY, 'Caller')]);
    const caller = await buildCaller(db, CALLER_KEY);
    expect(await errorCode(caller.users.updateProfile({ displayName: 'x'.repeat(51) }))).toBe('BAD_REQUEST');
  });
});

describe('users.search', () => {
  it('matches a displayName substring', async () => {
    const db = makeDb([
      user(1, CALLER_KEY, 'Caller'),
      user(2, `G${'B'.repeat(55)}`, 'Alice Smith'),
      user(3, `G${'C'.repeat(55)}`, 'Bob'),
    ]);
    const caller = await buildCaller(db, CALLER_KEY);
    const { results } = await caller.users.search({ query: 'ali' });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ publicKey: `G${'B'.repeat(55)}`, displayName: 'Alice Smith' });
  });

  it('matches a public-key prefix (case-sensitive for keys)', async () => {
    const db = makeDb([
      user(1, CALLER_KEY, 'Caller'),
      user(2, `G${'B'.repeat(55)}`, 'Alice'),
      user(3, `G${'C'.repeat(55)}`, 'Zed'),
    ]);
    const caller = await buildCaller(db, CALLER_KEY);
    const { results } = await caller.users.search({ query: 'GCC' });
    expect(results).toHaveLength(1);
    expect(results[0]!.publicKey).toBe(`G${'C'.repeat(55)}`);
  });

  it('excludes the caller from results', async () => {
    const db = makeDb([
      user(1, CALLER_KEY, 'Caller Name'),
      user(2, `G${'B'.repeat(55)}`, 'Other'),
    ]);
    const caller = await buildCaller(db, CALLER_KEY);
    const { results } = await caller.users.search({ query: 'call' });
    expect(results).toHaveLength(0);
  });

  it('limits results to 10', async () => {
    const rows = [user(1, CALLER_KEY, 'No Match')];
    for (let i = 0; i < 12; i++) {
      rows.push(user(i + 2, `G${'F'.repeat(10)}${i}${'F'.repeat(44)}`.slice(0, 56), `Matchy ${i}`));
    }
    const db = makeDb(rows);
    const caller = await buildCaller(db, CALLER_KEY);
    const { results } = await caller.users.search({ query: 'match' });
    expect(results.length).toBe(10);
  });
});


