import { describe, expect, it } from 'vitest';
import { intentSchema, signupSchema } from '../src/zod-schemas';

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
