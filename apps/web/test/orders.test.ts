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
    inArray: (column: unknown, values: unknown[]) => ({ kind: 'inArray', column, values }),
    and: (...conds: unknown[]) => ({ kind: 'and', conds }),
    or: (...conds: unknown[]) => ({ kind: 'or', conds }),
  };
});

const CALLER_KEY = `G${'A'.repeat(55)}`;
const OWNER_KEY = `G${'B'.repeat(55)}`;
const OTHER_KEY = `G${'C'.repeat(55)}`;

function user(overrides: Partial<User>): User {
  return {
    id: 1,
    stellarPublicKey: CALLER_KEY,
    email: 'caller@example.com',
    phone: null,
    displayName: 'Caller',
    passwordHash: 'pbkdf2$SHA-256$i=100000$abc$def',
    verificationState: 'unverified',
    role: 'user',
    totpSecret: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeDb() {
  const tables: Record<string, MockDbTable> = {
    users: {
      rows: [
        user({ id: 1, stellarPublicKey: CALLER_KEY, displayName: 'Caller' }),
        user({ id: 2, stellarPublicKey: OWNER_KEY, displayName: 'Owner' }),
        user({ id: 3, stellarPublicKey: OTHER_KEY, displayName: 'Other' }),
      ],
    },
    coffee_shops: {
      rows: [
        { id: 1, ownerUserId: 2, name: 'Cafe A', address: null, quoteOfTheDay: null, latitude: null, longitude: null, isActive: true, createdAt: new Date() },
        { id: 2, ownerUserId: null, name: 'No Owner', address: null, quoteOfTheDay: null, latitude: null, longitude: null, isActive: true, createdAt: new Date() },
        { id: 3, ownerUserId: 2, name: 'Closed', address: null, quoteOfTheDay: null, latitude: null, longitude: null, isActive: false, createdAt: new Date() },
      ],
    },
    menu_items: {
      rows: [
        { id: 1, coffeeShopId: 1, name: 'Espresso', price: '5000000', sortOrder: 0, createdAt: new Date() },
        { id: 2, coffeeShopId: 1, name: 'Latte', price: '7000000', sortOrder: 0, createdAt: new Date() },
        { id: 3, coffeeShopId: 3, name: 'Other', price: '1000000', sortOrder: 0, createdAt: new Date() },
      ],
    },
    orders: { rows: [] },
    order_items: { rows: [] },
    payments: { rows: [], unique: ['txHash'] },
    push_subscriptions: { rows: [], unique: ['endpoint'] },
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

describe('orders.place', () => {
  it('rejects an inactive shop', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);
    const code = await errorCode(
      caller.orders.place({ shopId: 3, items: [{ menuItemId: 1, quantity: 1 }], amount: '5000000', txHash: 'h1' }),
    );
    expect(code).toBe('NOT_FOUND');
  });

  it('rejects a shop without an owner', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);
    const code = await errorCode(
      caller.orders.place({ shopId: 2, items: [{ menuItemId: 1, quantity: 1 }], amount: '5000000', txHash: 'h2' }),
    );
    expect(code).toBe('PRECONDITION_FAILED');
  });

  it('rejects an unknown menu item', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);
    const code = await errorCode(
      caller.orders.place({ shopId: 1, items: [{ menuItemId: 99, quantity: 1 }], amount: '5000000', txHash: 'h3' }),
    );
    expect(code).toBe('BAD_REQUEST');
  });

  it('rejects a menu item that belongs to another shop', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);
    const code = await errorCode(
      caller.orders.place({ shopId: 1, items: [{ menuItemId: 3, quantity: 1 }], amount: '1000000', txHash: 'h4' }),
    );
    expect(code).toBe('BAD_REQUEST');
  });

  it('rejects duplicate menu items', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);
    const code = await errorCode(
      caller.orders.place({
        shopId: 1,
        items: [
          { menuItemId: 1, quantity: 1 },
          { menuItemId: 1, quantity: 2 },
        ],
        amount: '15000000',
        txHash: 'h5',
      }),
    );
    expect(code).toBe('BAD_REQUEST');
  });

  it('rejects empty items and zero quantities', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);
    expect(await errorCode(caller.orders.place({ shopId: 1, items: [], amount: '0', txHash: 'h6' }))).toBe('BAD_REQUEST');
    expect(
      await errorCode(caller.orders.place({ shopId: 1, items: [{ menuItemId: 1, quantity: 0 }], amount: '0', txHash: 'h7' })),
    ).toBe('BAD_REQUEST');
  });

  it('rejects when the total does not match the menu prices', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);
    const code = await errorCode(
      caller.orders.place({
        shopId: 1,
        items: [{ menuItemId: 1, quantity: 2 }],
        amount: '9999999',
        txHash: 'h8',
      }),
    );
    expect(code).toBe('CONFLICT');
  });

  it('records the order, items, and payment in one batch', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);
    const result = await caller.orders.place({
      shopId: 1,
      items: [
        { menuItemId: 1, quantity: 2 },
        { menuItemId: 2, quantity: 1 },
      ],
      amount: '17000000',
      txHash: 'h9',
    });
    expect(result).toEqual({ orderId: 1, totalAmount: '17000000' });

    const orders = db.table('orders').rows;
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ userId: 1, coffeeShopId: 1, totalAmount: '17000000', status: 'placed' });

    const items = db.table('order_items').rows;
    expect(items).toHaveLength(2);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orderId: 1, menuItemId: 1, name: 'Espresso', unitPrice: '5000000', quantity: 2 }),
        expect.objectContaining({ orderId: 1, menuItemId: 2, name: 'Latte', unitPrice: '7000000', quantity: 1 }),
      ]),
    );

    const payments = db.table('payments').rows;
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      userId: 1,
      coffeeShopId: 1,
      orderId: 1,
      amount: '17000000',
      asset: 'TAK',
      txHash: 'h9',
      status: 'submitted',
    });
  });

  it('is idempotent on the tx hash', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, CALLER_KEY);
    const input = { shopId: 1, items: [{ menuItemId: 1, quantity: 1 }], amount: '5000000', txHash: 'h10' };
    const first = await caller.orders.place(input);
    const second = await caller.orders.place(input);
    expect(first.orderId).toBe(second.orderId);
    expect(db.table('orders').rows).toHaveLength(1);
    expect(db.table('payments').rows).toHaveLength(1);
  });
});

describe('orders.listForOwner', () => {
  it('returns the order text and customer for an owned shop', async () => {
    const db = makeDb();
    db.table('orders').rows.push({
      id: 1,
      userId: 1,
      coffeeShopId: 1,
      totalAmount: '12000000',
      status: 'placed',
      createdAt: new Date('2026-01-01T10:00:00Z'),
      readyAt: null,
    });
    db.table('order_items').rows.push(
      { id: 1, orderId: 1, menuItemId: 1, name: 'Espresso', unitPrice: '5000000', quantity: 1 },
      { id: 2, orderId: 1, menuItemId: 2, name: 'Latte', unitPrice: '7000000', quantity: 1 },
    );
    const caller = await buildCaller(db, OWNER_KEY);
    const result = await caller.orders.listForOwner();
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      id: 1,
      shopName: 'Cafe A',
      customerPublicKey: CALLER_KEY,
      customerDisplayName: 'Caller',
      status: 'placed',
      itemsText: '1 Espresso + 1 Latte',
    });
  });

  it('returns an empty list for a non-owner', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, OTHER_KEY);
    const result = await caller.orders.listForOwner();
    expect(result.orders).toEqual([]);
  });
});

describe('orders.markReady', () => {
  function seedOrder(db: MockDb, status: string) {
    db.table('orders').rows.push({
      id: 1,
      userId: 1,
      coffeeShopId: 1,
      totalAmount: '5000000',
      status,
      createdAt: new Date(),
      readyAt: null,
    });
  }

  it('rejects a missing order', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, OWNER_KEY);
    expect(await errorCode(caller.orders.markReady({ orderId: 99 }))).toBe('NOT_FOUND');
  });

  it('rejects a non-owner', async () => {
    const db = makeDb();
    seedOrder(db, 'placed');
    const caller = await buildCaller(db, OTHER_KEY);
    expect(await errorCode(caller.orders.markReady({ orderId: 1 }))).toBe('FORBIDDEN');
  });

  it('rejects an already-ready order', async () => {
    const db = makeDb();
    seedOrder(db, 'ready');
    const caller = await buildCaller(db, OWNER_KEY);
    expect(await errorCode(caller.orders.markReady({ orderId: 1 }))).toBe('CONFLICT');
  });

  it('marks a placed order ready', async () => {
    const db = makeDb();
    seedOrder(db, 'placed');
    const caller = await buildCaller(db, OWNER_KEY);
    const result = await caller.orders.markReady({ orderId: 1 });
    expect(result).toEqual({ ok: true });
    const row = db.table('orders').rows.find((r) => r.id === 1);
    expect(row).toMatchObject({ status: 'ready' });
    expect(row?.readyAt).toBeInstanceOf(Date);
  });
});
