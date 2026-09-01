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
const RECIPIENT_KEY = `G${'B'.repeat(55)}`;
const UNKNOWN_KEY = `G${'D'.repeat(55)}`;

function user(overrides: Partial<User>): User {
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
    ...overrides,
  };
}

function makeDb(paymentsRows: Record<string, unknown>[] = []) {
  const tables: Record<string, MockDbTable> = {
    users: {
      rows: [
        user({ id: 1, stellarPublicKey: CALLER_KEY, displayName: 'Caller' }),
        user({ id: 2, stellarPublicKey: RECIPIENT_KEY, displayName: 'Recipient' }),
      ],
    },
    coffee_shops: {
      rows: [
        { id: 1, ownerUserId: 2, name: 'Cafe A', address: null, isActive: true, createdAt: new Date() },
        { id: 2, ownerUserId: null, name: 'No Owner', address: null, isActive: true, createdAt: new Date() },
        { id: 3, ownerUserId: 2, name: 'Closed', address: null, isActive: false, createdAt: new Date() },
      ],
    },
    payments: { rows: paymentsRows, unique: ['txHash'] },
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

describe('payments.record', () => {
  it('rejects when neither a shop nor a recipient is given', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);
    const code = await errorCode(
      caller.payments.record({ txHash: 'h1', amount: '10000000', asset: 'TAK' }),
    );
    expect(code).toBe('BAD_REQUEST');
  });

  it('rejects when both a shop and a recipient are given', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);
    const code = await errorCode(
      caller.payments.record({
        txHash: 'h1',
        amount: '10000000',
        asset: 'TAK',
        coffeeShopId: 1,
        recipientPublicKey: RECIPIENT_KEY,
      }),
    );
    expect(code).toBe('BAD_REQUEST');
  });

  it('records a coffee shop payment to the owner account', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);
    const result = await caller.payments.record({
      txHash: 'h-shop',
      amount: '10000000',
      asset: 'TAK',
      coffeeShopId: 1,
    });
    expect(result).toEqual({ ok: true, id: 1 });
    const rows = db.table('payments').rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: 1,
      coffeeShopId: 1,
      recipientPublicKey: RECIPIENT_KEY,
      txHash: 'h-shop',
      status: 'submitted',
      asset: 'TAK',
      amount: '10000000',
    });
  });

  it('rejects a payment to an inactive shop', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);
    const code = await errorCode(
      caller.payments.record({ txHash: 'h2', amount: '10000000', asset: 'TAK', coffeeShopId: 3 }),
    );
    expect(code).toBe('NOT_FOUND');
  });

  it('rejects a payment to a shop without an owner', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);
    const code = await errorCode(
      caller.payments.record({ txHash: 'h3', amount: '10000000', asset: 'TAK', coffeeShopId: 2 }),
    );
    expect(code).toBe('PRECONDITION_FAILED');
  });

  it('rejects a payment to an unknown recipient', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);
    const code = await errorCode(
      caller.payments.record({ txHash: 'h4', amount: '10000000', asset: 'TAK', recipientPublicKey: UNKNOWN_KEY }),
    );
    expect(code).toBe('NOT_FOUND');
  });

  it('rejects sending to yourself', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);
    const code = await errorCode(
      caller.payments.record({ txHash: 'h5', amount: '10000000', asset: 'TAK', recipientPublicKey: CALLER_KEY }),
    );
    expect(code).toBe('CONFLICT');
  });

  it('records a P2P payment', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);
    const result = await caller.payments.record({
      txHash: 'h6',
      amount: '5000000',
      asset: 'TAK',
      recipientPublicKey: RECIPIENT_KEY,
    });
    expect(result).toEqual({ ok: true, id: 1 });
    const rows = db.table('payments').rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: 1,
      coffeeShopId: null,
      recipientPublicKey: RECIPIENT_KEY,
      txHash: 'h6',
      status: 'submitted',
    });
  });

  it('is idempotent for a duplicate tx hash', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);
    const input = { txHash: 'h7', amount: '10000000', asset: 'TAK' as const, recipientPublicKey: RECIPIENT_KEY };
    const first = await caller.payments.record(input);
    const second = await caller.payments.record(input);
    expect(first.id).toBe(second.id);
    expect(db.table('payments').rows).toHaveLength(1);
  });
});


