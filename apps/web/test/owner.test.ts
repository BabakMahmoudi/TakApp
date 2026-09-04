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

const OWNER_KEY = `G${'C'.repeat(55)}`;
const OTHER_KEY = `G${'D'.repeat(55)}`;
const ADMIN_KEY = `G${'A'.repeat(55)}`;

function user(id: number, publicKey: string, role: User['role']): User {
  return {
    id,
    stellarPublicKey: publicKey,
    email: `user${id}@example.com`,
    phone: null,
    displayName: null,
    passwordHash: 'pbkdf2$SHA-256$i=100000$abc$def',
    verificationState: 'unverified',
    role,
    totpSecret: null,
    createdAt: new Date(),
  };
}

function shop(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    ownerUserId: 1,
    name: 'Cafe A',
    address: '123 Main St',
    quoteOfTheDay: 'Fresh beans',
    latitude: 35.7,
    longitude: 51.4,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeDb() {
  const tables: Record<string, MockDbTable> = {
    users: {
      rows: [user(1, OWNER_KEY, 'user'), user(2, OTHER_KEY, 'user'), user(3, ADMIN_KEY, 'admin')],
    },
    coffee_shops: {
      rows: [shop({ id: 1, ownerUserId: 1 }), shop({ id: 2, ownerUserId: 2, name: 'Cafe B' })],
    },
    menu_items: {
      rows: [
        { id: 10, coffeeShopId: 1, name: 'Old item', price: '1000000', sortOrder: 0, createdAt: new Date() },
      ],
    },
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

describe('owner.mine', () => {
  it('lists only the shops the caller owns, with their menu', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, OWNER_KEY);
    const result = await caller.owner.mine();
    expect(result.shops).toHaveLength(1);
    expect(result.shops[0]).toMatchObject({
      id: 1,
      name: 'Cafe A',
      ownerPublicKey: OWNER_KEY,
      quoteOfTheDay: 'Fresh beans',
      latitude: 35.7,
      longitude: 51.4,
    });
    expect(result.shops[0]?.menu).toEqual([{ id: 10, name: 'Old item', price: '1000000' }]);
  });

  it('returns an empty list for a non-owner', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, ADMIN_KEY);
    const result = await caller.owner.mine();
    expect(result.shops).toHaveLength(0);
  });
});

describe('owner.update', () => {
  it('rejects a non-owner', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, OTHER_KEY);
    const code = await errorCode(caller.owner.update({ id: 1, name: 'Hijack' }));
    expect(code).toBe('FORBIDDEN');
  });

  it('allows the owner to edit their shop', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, OWNER_KEY);
    const result = await caller.owner.update({ id: 1, name: 'Renamed' });
    expect(result).toEqual({ ok: true });
    expect(db.table('coffee_shops').rows.find((row) => row.id === 1)).toMatchObject({ name: 'Renamed' });
  });

  it('allows an admin to edit any shop', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, ADMIN_KEY);
    const result = await caller.owner.update({ id: 2, name: 'Admin edit' });
    expect(result).toEqual({ ok: true });
    expect(db.table('coffee_shops').rows.find((row) => row.id === 2)).toMatchObject({ name: 'Admin edit' });
  });

  it('clears address and quote on empty string', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, OWNER_KEY);
    await caller.owner.update({ id: 1, address: '', quoteOfTheDay: '' });
    expect(db.table('coffee_shops').rows.find((row) => row.id === 1)).toMatchObject({
      address: null,
      quoteOfTheDay: null,
    });
  });

  it('clears latitude and longitude on null', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, OWNER_KEY);
    await caller.owner.update({ id: 1, latitude: null, longitude: null });
    expect(db.table('coffee_shops').rows.find((row) => row.id === 1)).toMatchObject({
      latitude: null,
      longitude: null,
    });
  });

  it('rejects out-of-bounds coordinates', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, OWNER_KEY);
    expect(await errorCode(caller.owner.update({ id: 1, latitude: 200 }))).toBe('BAD_REQUEST');
    expect(await errorCode(caller.owner.update({ id: 1, longitude: -200 }))).toBe('BAD_REQUEST');
  });
});

describe('owner.saveMenu', () => {
  it('replaces the whole menu atomically', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, OWNER_KEY);
    const result = await caller.owner.saveMenu({
      shopId: 1,
      items: [
        { name: 'Espresso', price: '2000000' },
        { name: 'Latte', price: '3000000' },
      ],
    });
    expect(result).toEqual({ ok: true });
    const rows = db.table('menu_items').rows.filter((row) => row.coffeeShopId === 1);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.name).sort()).toEqual(['Espresso', 'Latte']);
    expect(rows.find((row) => row.name === 'Old item')).toBeUndefined();
  });

  it('enforces ownership', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, OTHER_KEY);
    const code = await errorCode(caller.owner.saveMenu({ shopId: 1, items: [{ name: 'X', price: '1000000' }] }));
    expect(code).toBe('FORBIDDEN');
  });

  it('rejects an empty name or a zero price', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, OWNER_KEY);
    expect(
      await errorCode(caller.owner.saveMenu({ shopId: 1, items: [{ name: '', price: '1000000' }] })),
    ).toBe('BAD_REQUEST');
    expect(
      await errorCode(caller.owner.saveMenu({ shopId: 1, items: [{ name: 'X', price: '0' }] })),
    ).toBe('BAD_REQUEST');
  });
});
