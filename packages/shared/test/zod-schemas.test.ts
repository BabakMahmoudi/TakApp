import { describe, expect, it } from 'vitest';
import {
  intentSchema,
  menuItemInputSchema,
  paymentRecordSchema,
  shopLocationSchema,
  signupSchema,
} from '../src/zod-schemas';

const VALID_PUBLIC_KEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

describe('signup schema', () => {
  it('accepts email-only, phone-only, and both', () => {
    expect(
      signupSchema.safeParse({ email: 'a@b.com', password: 'longenough', publicKey: VALID_PUBLIC_KEY })
        .success,
    ).toBe(true);
    expect(
      signupSchema.safeParse({ phone: '+989120000000', password: 'longenough', publicKey: VALID_PUBLIC_KEY })
        .success,
    ).toBe(true);
  });

  it('rejects neither email nor phone', () => {
    const result = signupSchema.safeParse({
      password: 'longenough',
      publicKey: VALID_PUBLIC_KEY,
    });
    expect(result.success).toBe(false);
  });

  it('rejects short passwords and malformed public keys', () => {
    expect(
      signupSchema.safeParse({ email: 'a@b.com', password: 'short', publicKey: VALID_PUBLIC_KEY })
        .success,
    ).toBe(false);
    expect(
      signupSchema.safeParse({ email: 'a@b.com', password: 'longenough', publicKey: 'not-a-key' })
        .success,
    ).toBe(false);
  });
});

describe('intent schema', () => {
  it('accepts all read-only commands', () => {
    expect(intentSchema.safeParse({ action: 'balance' }).success).toBe(true);
    expect(intentSchema.safeParse({ action: 'balance', asset: 'TAK' }).success).toBe(true);
    expect(intentSchema.safeParse({ action: 'shops' }).success).toBe(true);
    expect(intentSchema.safeParse({ action: 'history', limit: 5 }).success).toBe(true);
  });

  it('rejects unknown actions and unknown assets', () => {
    expect(intentSchema.safeParse({ action: 'send' }).success).toBe(false);
    expect(intentSchema.safeParse({ action: 'balance', asset: 'DOGE' }).success).toBe(false);
  });

  it('rejects non-object output', () => {
    expect(intentSchema.safeParse('give me money').success).toBe(false);
    expect(intentSchema.safeParse(null).success).toBe(false);
  });
});

describe('menu item schema', () => {
  it('accepts a name and a positive stroop price', () => {
    expect(menuItemInputSchema.safeParse({ name: 'Espresso', price: '10000000' }).success).toBe(true);
  });

  it('rejects a zero or negative price', () => {
    expect(menuItemInputSchema.safeParse({ name: 'Espresso', price: '0' }).success).toBe(false);
    expect(menuItemInputSchema.safeParse({ name: 'Espresso', price: '-5' }).success).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(menuItemInputSchema.safeParse({ name: '', price: '10000000' }).success).toBe(false);
    expect(menuItemInputSchema.safeParse({ name: '   ', price: '10000000' }).success).toBe(false);
  });
});

describe('shop location schema', () => {
  it('accepts valid coordinates', () => {
    expect(shopLocationSchema.safeParse({ latitude: 35.7, longitude: 51.4 }).success).toBe(true);
  });

  it('rejects out-of-range coordinates', () => {
    expect(shopLocationSchema.safeParse({ latitude: 91, longitude: 51.4 }).success).toBe(false);
    expect(shopLocationSchema.safeParse({ latitude: 35.7, longitude: -181 }).success).toBe(false);
  });
});

describe('payment record menuItemId refine', () => {
  const base = {
    txHash: 'h1',
    amount: '10000000',
    asset: 'TAK' as const,
    recipientPublicKey: VALID_PUBLIC_KEY,
  };

  it('requires coffeeShopId when menuItemId is present', () => {
    expect(paymentRecordSchema.safeParse({ ...base, menuItemId: 1 }).success).toBe(false);
    expect(
      paymentRecordSchema.safeParse({ txHash: 'h1', amount: '10000000', asset: 'TAK', coffeeShopId: 1, menuItemId: 1 })
        .success,
    ).toBe(true);
  });

  it('allows menuItemId to be omitted', () => {
    expect(paymentRecordSchema.safeParse(base).success).toBe(true);
  });
});
