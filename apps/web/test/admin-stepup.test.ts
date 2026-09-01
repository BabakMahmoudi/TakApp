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

const ADMIN_KEY = `G${'A'.repeat(55)}`;

function user(id: number, publicKey: string, role: User['role']): User {
  return {
    id,
    stellarPublicKey: publicKey,
    email: `user${id}@example.com`,
    phone: null,
    displayName: null,
    passwordHash: 'pbkdf2$SHA-256$i=600000$abc$def',
    verificationState: 'unverified',
    role,
    totpSecret: null,
    createdAt: new Date(),
  };
}

function makeDb(users: User[]) {
  const tables: Record<string, MockDbTable> = {
    users: { rows: users },
    coffee_shops: { rows: [] },
    sessions: { rows: [] },
    admin_audit_log: { rows: [] },
    admin_step_up_attempts: { rows: [] },
  };
  return new MockDb(tables);
}

describe('admin.stepUp', () => {
  it('issues an admin token without a TOTP code when the flag is off', async () => {
    const db = makeDb([user(1, ADMIN_KEY, 'admin')]);
    const caller = await buildCaller(db, ADMIN_KEY, { ADMIN_TOTP_REQUIRED: 'false' });
    const result = await caller.admin.stepUp({ code: '000000' });
    expect(result.token).toBeTruthy();
    expect(db.table('admin_audit_log').rows).toHaveLength(1);
  });

  it('still requires enrollment when the flag is off and a wrong code is sent', async () => {
    const db = makeDb([user(1, ADMIN_KEY, 'admin')]);
    const caller = await buildCaller(db, ADMIN_KEY, { ADMIN_TOTP_REQUIRED: 'false' });
    const result = await caller.admin.stepUp({ code: '123456' });
    expect(result.token).toBeTruthy();
  });

  it('rejects a non-admin user even when the flag is off', async () => {
    const regularKey = `G${'B'.repeat(55)}`;
    const db = makeDb([user(1, regularKey, 'user')]);
    const caller = await buildCaller(db, regularKey, { ADMIN_TOTP_REQUIRED: 'false' });
    expect(await errorCode(caller.admin.stepUp({ code: '000000' }))).toBe('FORBIDDEN');
  });

  it('requires TOTP enrollment by default', async () => {
    const db = makeDb([user(1, ADMIN_KEY, 'admin')]);
    const caller = await buildCaller(db, ADMIN_KEY);
    expect(await errorCode(caller.admin.stepUp({ code: '000000' }))).toBe('PRECONDITION_FAILED');
  });
});
