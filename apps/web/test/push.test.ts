import { describe, expect, it, vi } from 'vitest';
import type { User } from '@takapp/shared/db';
import { appRouter } from '../src/server/trpc/router';
import type { TrpcContext } from '../src/server/trpc/context';
import { buildCaller, errorCode, testEnv } from './helpers/caller';
import { MockDb, type MockDbTable } from './helpers/mock-db';

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: unknown, value: unknown) => ({ kind: 'eq', column, value }),
    ne: (column: unknown, value: unknown) => ({ kind: 'ne', column, value }),
    like: (column: unknown, value: unknown) => ({ kind: 'like', column, value }),
    inArray: (column: unknown, values: unknown[]) => ({ kind: 'inArray', column, values }),
    and: (...conds: unknown[]) => ({ kind: 'and', conds }),
    or: (...conds: unknown[]) => ({ kind: 'or', conds }),
  };
});

const CALLER_KEY = `G${'A'.repeat(55)}`;

function user(): User {
  return {
    id: 1,
    stellarPublicKey: CALLER_KEY,
    email: 'caller@example.com',
    phone: null,
    displayName: null,
    passwordHash: 'pbkdf2$SHA-256$i=100000$abc$def',
    verificationState: 'unverified',
    role: 'user',
    totpSecret: null,
    createdAt: new Date(),
  };
}

function makeDb() {
  const tables: Record<string, MockDbTable> = {
    users: { rows: [user()] },
    push_subscriptions: { rows: [], unique: ['endpoint'] },
    sessions: { rows: [] },
    gifts: { rows: [] },
    verifications: { rows: [] },
    telegram_bindings: { rows: [] },
    conversations: { rows: [] },
    admin_audit_log: { rows: [] },
    admin_step_up_attempts: { rows: [] },
    coffee_shops: { rows: [] },
    menu_items: { rows: [] },
    orders: { rows: [] },
    order_items: { rows: [] },
    payments: { rows: [], unique: ['txHash'] },
  };
  return new MockDb(tables);
}

function unauthenticatedCaller(db: MockDb) {
  const context: TrpcContext = {
    db: db as unknown as TrpcContext['db'],
    env: testEnv,
    req: new Request('http://localhost'),
    reqId: 'test',
  };
  return appRouter.createCaller(context);
}

describe('push router', () => {
  it('exposes the VAPID public key without a session', async () => {
    const db = makeDb();
    const caller = unauthenticatedCaller(db);
    const result = await caller.push.publicKey();
    expect(result.vapidPublicKey).toBe(testEnv.VAPID_PUBLIC_KEY);
  });

  it('rejects subscribe without a session', async () => {
    const db = makeDb();
    const caller = unauthenticatedCaller(db);
    const code = await errorCode(
      caller.push.subscribe({ endpoint: 'https://push.example/1', p256dh: 'a', auth: 'b' }),
    );
    expect(code).toBe('UNAUTHORIZED');
  });

  it('rejects unsubscribe without a session', async () => {
    const db = makeDb();
    const caller = unauthenticatedCaller(db);
    const code = await errorCode(caller.push.unsubscribe({ endpoint: 'https://push.example/1' }));
    expect(code).toBe('UNAUTHORIZED');
  });

  it('subscribes and upserts on the same endpoint', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);
    await caller.push.subscribe({ endpoint: 'https://push.example/1', p256dh: 'a', auth: 'b' });
    expect(db.table('push_subscriptions').rows).toHaveLength(1);
    expect(db.table('push_subscriptions').rows[0]).toMatchObject({
      userId: 1,
      endpoint: 'https://push.example/1',
      p256dh: 'a',
      auth: 'b',
    });
    await caller.push.subscribe({ endpoint: 'https://push.example/1', p256dh: 'a2', auth: 'b2' });
    expect(db.table('push_subscriptions').rows).toHaveLength(1);
    expect(db.table('push_subscriptions').rows[0]).toMatchObject({ p256dh: 'a2', auth: 'b2' });
  });

  it('unsubscribes only the caller own endpoint', async () => {
    const db = makeDb();
    db.table('push_subscriptions').rows.push({
      id: 1,
      userId: 999,
      endpoint: 'https://push.example/other',
      p256dh: 'x',
      auth: 'y',
      createdAt: new Date(),
    });
    const caller = await buildCaller(db, CALLER_KEY);
    await caller.push.subscribe({ endpoint: 'https://push.example/1', p256dh: 'a', auth: 'b' });
    await caller.push.unsubscribe({ endpoint: 'https://push.example/other' });
    expect(db.table('push_subscriptions').rows).toHaveLength(2);
    await caller.push.unsubscribe({ endpoint: 'https://push.example/1' });
    expect(db.table('push_subscriptions').rows).toHaveLength(1);
    expect(db.table('push_subscriptions').rows[0]).toMatchObject({ endpoint: 'https://push.example/other' });
  });
});
