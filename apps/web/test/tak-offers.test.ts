import { describe, expect, it, vi } from 'vitest';
import type { TrpcContext } from '../src/server/trpc/context';
import { MockDb, type MockDbTable } from './helpers/mock-db';
import { takOfferInputSchema } from '@takapp/shared/zod-schemas';
import {
  list,
  medianPriceRial,
  OfferError,
  OFFER_TTL_MS,
  remove,
  renew,
  upsert,
} from '../src/server/offers/service';

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: unknown, value: unknown) => ({ kind: 'eq', column, value }),
    gt: (column: unknown, value: unknown) => ({ kind: 'gt', column, value }),
    inArray: (column: unknown, values: unknown[]) => ({ kind: 'inArray', column, values }),
    asc: (column: unknown) => ({ kind: 'asc', column }),
  };
});

const SELLER_ID = 1;
const OTHER_ID = 2;
const SELLER_PUBLIC_KEY = `G${'A'.repeat(55)}`;
const OTHER_PUBLIC_KEY = `G${'B'.repeat(55)}`;

function user(id: number, publicKey: string, displayName: string | null = null) {
  return {
    id,
    stellarPublicKey: publicKey,
    email: `user${id}@example.com`,
    phone: null,
    displayName,
    passwordHash: 'pbkdf2$SHA-256$i=100000$abc$def',
    verificationState: 'verified',
    role: 'user',
    totpSecret: null,
    createdAt: new Date(),
  };
}

function offer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Date.now();
  return {
    id: 1,
    sellerUserId: SELLER_ID,
    priceRial: 500_000,
    amountStroops: '10000000',
    memo: 'Contact me on Telegram @seller',
    createdAt: new Date(now - 1000),
    expiresAt: new Date(now + OFFER_TTL_MS),
    ...overrides,
  };
}

function makeDb(
  overrides: {
    takOffers?: Record<string, unknown>[];
    users?: Record<string, unknown>[];
  } = {},
) {
  const tables: Record<string, MockDbTable> = {
    users: {
      rows: overrides.users ?? [
        user(SELLER_ID, SELLER_PUBLIC_KEY, 'Seller'),
        user(OTHER_ID, OTHER_PUBLIC_KEY, 'Other'),
      ],
    },
    tak_offers: { rows: overrides.takOffers ?? [], unique: ['sellerUserId'] },
  };
  return new MockDb(tables);
}

function asDb(db: MockDb): TrpcContext['db'] {
  return db as unknown as TrpcContext['db'];
}

async function offerErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof OfferError ? error.code : undefined;
  }
}

describe('medianPriceRial', () => {
  it('returns null for an empty list', () => {
    expect(medianPriceRial([])).toBeNull();
  });

  it('returns the middle value for an odd count', () => {
    expect(medianPriceRial([3, 1, 2])).toBe(2);
  });

  it('returns the rounded average of the two middle values for an even count', () => {
    expect(medianPriceRial([1, 2, 3, 4])).toBe(3);
    expect(medianPriceRial([1, 2, 3, 6])).toBe(3);
  });
});

describe('upsert', () => {
  it('creates a row with the correct fields and a 24h expiry', async () => {
    const db = makeDb();
    const result = await upsert(asDb(db), SELLER_ID, {
      priceRial: 500_000,
      amountStroops: '10000000',
      memo: 'Contact me',
    });

    expect(result.active).toBe(true);
    expect(result.priceRial).toBe(500_000);
    expect(result.amountStroops).toBe('10000000');

    const rows = db.table('tak_offers').rows;
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.sellerUserId).toBe(SELLER_ID);
    expect(row.priceRial).toBe(500_000);
    expect(row.amountStroops).toBe('10000000');
    expect(row.memo).toBe('Contact me');
    const expiresAt = row.expiresAt as Date;
    expect(Math.abs(expiresAt.getTime() - (Date.now() + OFFER_TTL_MS))).toBeLessThan(2000);
  });

  it('stores NULL amount for an unlimited offer', async () => {
    const db = makeDb();
    await upsert(asDb(db), SELLER_ID, { priceRial: 100, memo: 'Call me' });
    const row = db.table('tak_offers').rows[0]!;
    expect(row.amountStroops).toBeNull();
  });

  it('replaces an existing offer for the same seller', async () => {
    const db = makeDb({ takOffers: [offer({ priceRial: 100_000 })] });
    await upsert(asDb(db), SELLER_ID, { priceRial: 900_000, memo: 'New contact' });

    const rows = db.table('tak_offers').rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.priceRial).toBe(900_000);
    expect(rows[0]!.memo).toBe('New contact');
  });
});

describe('list', () => {
  it('filters expired offers and sorts ascending by price', async () => {
    const now = Date.now();
    const db = makeDb({
      takOffers: [
        offer({ id: 1, sellerUserId: OTHER_ID, priceRial: 700_000, expiresAt: new Date(now + 1000) }),
        offer({ id: 2, sellerUserId: OTHER_ID, priceRial: 300_000, expiresAt: new Date(now + 2000) }),
        offer({ id: 3, sellerUserId: SELLER_ID, priceRial: 100_000, expiresAt: new Date(now - 1000) }),
      ],
    });

    const result = await list(asDb(db), OTHER_ID);
    expect(result.offers.map((o) => o.priceRial)).toEqual([300_000, 700_000]);
    expect(result.referencePriceRial).toBe(500_000);
    expect(result.offers.every((o) => o.sellerDisplayName === 'Other')).toBe(true);
    expect(result.offers.every((o) => o.sellerPublicKey === OTHER_PUBLIC_KEY)).toBe(true);
  });

  it('computes a null reference price when there are no active offers', async () => {
    const db = makeDb();
    const result = await list(asDb(db), SELLER_ID);
    expect(result.offers).toEqual([]);
    expect(result.referencePriceRial).toBeNull();
  });

  it('flags the caller own offer', async () => {
    const now = Date.now();
    const db = makeDb({
      takOffers: [
        offer({ id: 1, sellerUserId: SELLER_ID, priceRial: 100_000, expiresAt: new Date(now + 1000) }),
        offer({ id: 2, sellerUserId: OTHER_ID, priceRial: 200_000, expiresAt: new Date(now + 1000) }),
      ],
    });
    const result = await list(asDb(db), SELLER_ID);
    const own = result.offers.find((o) => o.id === 1);
    const other = result.offers.find((o) => o.id === 2);
    expect(own?.isMine).toBe(true);
    expect(other?.isMine).toBe(false);
  });
});

describe('mine', () => {
  it('returns the caller own row with the active flag when present', async () => {
    const now = Date.now();
    const db = makeDb({
      takOffers: [offer({ id: 1, sellerUserId: SELLER_ID, expiresAt: new Date(now + 1000) })],
    });
    const result = await list(asDb(db), SELLER_ID);
    expect(result.mine).not.toBeNull();
    expect(result.mine!.id).toBe(1);
    expect(result.mine!.active).toBe(true);
  });

  it('returns an inactive flag for an expired own row', async () => {
    const db = makeDb({
      takOffers: [offer({ id: 1, sellerUserId: SELLER_ID, expiresAt: new Date(Date.now() - 1000) })],
    });
    const result = await list(asDb(db), SELLER_ID);
    expect(result.mine).not.toBeNull();
    expect(result.mine!.active).toBe(false);
  });

  it('returns null when the caller has no offer', async () => {
    const db = makeDb();
    const result = await list(asDb(db), SELLER_ID);
    expect(result.mine).toBeNull();
  });
});

describe('renew', () => {
  it('extends the expiry by 24h', async () => {
    const db = makeDb({
      takOffers: [offer({ id: 1, sellerUserId: SELLER_ID, expiresAt: new Date(Date.now() - 1000) })],
    });
    const before = (db.table('tak_offers').rows[0]!.expiresAt as Date).getTime();
    const result = await renew(asDb(db), SELLER_ID);
    expect(result.active).toBe(true);
    const after = (db.table('tak_offers').rows[0]!.expiresAt as Date).getTime();
    expect(after).toBeGreaterThan(before);
    expect(Math.abs(after - (Date.now() + OFFER_TTL_MS))).toBeLessThan(2000);
  });

  it('throws OFFER_NOT_FOUND when the caller has no offer', async () => {
    const db = makeDb();
    const code = await offerErrorCode(renew(asDb(db), SELLER_ID));
    expect(code).toBe('OFFER_NOT_FOUND');
  });
});

describe('remove', () => {
  it('deletes the caller own row', async () => {
    const db = makeDb({ takOffers: [offer({ id: 1, sellerUserId: SELLER_ID })] });
    await remove(asDb(db), SELLER_ID);
    expect(db.table('tak_offers').rows).toHaveLength(0);
  });

  it('is a no-op when there is nothing to delete', async () => {
    const db = makeDb();
    await expect(remove(asDb(db), SELLER_ID)).resolves.toBeUndefined();
  });
});

describe('takOfferInputSchema', () => {
  it('rejects a non-positive price', () => {
    expect(takOfferInputSchema.safeParse({ priceRial: 0, memo: 'x' }).success).toBe(false);
    expect(takOfferInputSchema.safeParse({ priceRial: 1.5, memo: 'x' }).success).toBe(false);
  });

  it('rejects a non-positive amount', () => {
    expect(
      takOfferInputSchema.safeParse({ priceRial: 10, amountStroops: '0', memo: 'x' }).success,
    ).toBe(false);
  });

  it('rejects an empty or overlong memo', () => {
    expect(takOfferInputSchema.safeParse({ priceRial: 10, memo: '   ' }).success).toBe(false);
    expect(takOfferInputSchema.safeParse({ priceRial: 10, memo: 'x'.repeat(241) }).success).toBe(false);
  });

  it('accepts a valid offer with and without an amount', () => {
    expect(
      takOfferInputSchema.safeParse({ priceRial: 10, amountStroops: '10000000', memo: 'hi' }).success,
    ).toBe(true);
    expect(takOfferInputSchema.safeParse({ priceRial: 10, memo: 'hi' }).success).toBe(true);
  });
});
