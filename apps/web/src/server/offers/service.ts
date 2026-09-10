import { asc, eq, gt, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { takOffers, users } from '@takapp/shared/db';
import type { TakOffer } from '@takapp/shared/db';
import type { TakOfferInput } from '@takapp/shared/zod-schemas';
import type { TrpcContext } from '../trpc/context';

type Db = TrpcContext['db'];

export const OFFER_TTL_MS = 24 * 60 * 60 * 1000;
const OFFERS_LIMIT = 200;

export type OfferErrorCode = 'OFFER_NOT_FOUND' | 'INTERNAL';

export class OfferError extends Error {
  constructor(
    message: string,
    public code: OfferErrorCode,
  ) {
    super(message);
    this.name = 'OfferError';
  }
}

export function toTrpcOfferError(error: OfferError): TRPCError {
  const code = error.code === 'OFFER_NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR';
  return new TRPCError({ code, message: error.code });
}

export async function withOfferErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof OfferError) {
      throw toTrpcOfferError(error);
    }
    throw error;
  }
}

export function medianPriceRial(prices: number[]): number | null {
  if (prices.length === 0) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export interface OfferListItem {
  id: number;
  priceRial: number;
  amountStroops: string | null;
  memo: string;
  sellerDisplayName: string | null;
  sellerPublicKey: string;
  isMine: boolean;
}

export interface MyOffer {
  id: number;
  priceRial: number;
  amountStroops: string | null;
  memo: string;
  createdAt: number;
  expiresAt: number;
  active: boolean;
}

export interface OfferListResult {
  offers: OfferListItem[];
  referencePriceRial: number | null;
  mine: MyOffer | null;
}

function toMyOffer(offer: TakOffer, now: Date): MyOffer {
  return {
    id: offer.id,
    priceRial: offer.priceRial,
    amountStroops: offer.amountStroops,
    memo: offer.memo,
    createdAt: offer.createdAt.getTime(),
    expiresAt: offer.expiresAt.getTime(),
    active: offer.expiresAt.getTime() > now.getTime(),
  };
}

async function getMine(db: Db, userId: number, now: Date): Promise<MyOffer | null> {
  const [row] = await db.select().from(takOffers).where(eq(takOffers.sellerUserId, userId)).limit(1);
  return row ? toMyOffer(row, now) : null;
}

export async function list(db: Db, userId: number): Promise<OfferListResult> {
  const now = new Date();
  const rows = await db
    .select()
    .from(takOffers)
    .where(gt(takOffers.expiresAt, now))
    .orderBy(asc(takOffers.priceRial), asc(takOffers.id))
    .limit(OFFERS_LIMIT);

  const sellerIds = [...new Set(rows.map((row) => row.sellerUserId))];
  const sellerRows =
    sellerIds.length > 0 ? await db.select().from(users).where(inArray(users.id, sellerIds)) : [];
  const sellerById = new Map(sellerRows.map((seller) => [seller.id, seller]));

  const offers: OfferListItem[] = rows.map((row) => {
    const seller = sellerById.get(row.sellerUserId);
    return {
      id: row.id,
      priceRial: row.priceRial,
      amountStroops: row.amountStroops,
      memo: row.memo,
      sellerDisplayName: seller?.displayName ?? null,
      sellerPublicKey: seller?.stellarPublicKey ?? '',
      isMine: row.sellerUserId === userId,
    };
  });

  const referencePriceRial = medianPriceRial(rows.map((row) => row.priceRial));
  const mine = await getMine(db, userId, now);
  return { offers, referencePriceRial, mine };
}

export async function upsert(db: Db, userId: number, input: TakOfferInput): Promise<MyOffer> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OFFER_TTL_MS);
  const values = {
    sellerUserId: userId,
    priceRial: input.priceRial,
    amountStroops: input.amountStroops ?? null,
    memo: input.memo,
    createdAt: now,
    expiresAt,
  };
  const [offer] = await db
    .insert(takOffers)
    .values(values)
    .onConflictDoUpdate({
      target: takOffers.sellerUserId,
      set: {
        priceRial: values.priceRial,
        amountStroops: values.amountStroops,
        memo: values.memo,
        createdAt: values.createdAt,
        expiresAt: values.expiresAt,
      },
    })
    .returning();
  if (!offer) {
    throw new OfferError('Failed to save offer', 'INTERNAL');
  }
  return toMyOffer(offer, now);
}

export async function renew(db: Db, userId: number): Promise<MyOffer> {
  const now = new Date();
  const [row] = await db.select().from(takOffers).where(eq(takOffers.sellerUserId, userId)).limit(1);
  if (!row) {
    throw new OfferError('Offer not found', 'OFFER_NOT_FOUND');
  }
  const expiresAt = new Date(now.getTime() + OFFER_TTL_MS);
  await db.update(takOffers).set({ expiresAt }).where(eq(takOffers.sellerUserId, userId));
  return toMyOffer({ ...row, expiresAt }, now);
}

export async function remove(db: Db, userId: number): Promise<void> {
  await db.delete(takOffers).where(eq(takOffers.sellerUserId, userId));
}
