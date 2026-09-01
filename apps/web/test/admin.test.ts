import { generateSync } from 'otplib';
import { describe, expect, it } from 'vitest';
import { totpProvider } from '@takapp/shared/verification';
import type { User } from '@takapp/shared/db';
import {
  MAX_STEP_UP_FAILURES,
  STEP_UP_LOCKOUT_MS,
  canDemote,
  canPromote,
  isAdminUser,
  isBootstrapAdmin,
  isLocked,
  nextThrottleState,
  resetThrottle,
} from '../src/server/admin/guards';
import { verifyTotpCode } from '../src/server/admin/totp';

const BOOTSTRAP_KEY = `G${'B'.repeat(55)}`;
const REGULAR_KEY = `G${'C'.repeat(55)}`;

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    stellarPublicKey: REGULAR_KEY,
    email: 'user@example.com',
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

describe('admin guards', () => {
  it('recognizes the bootstrap public key', () => {
    expect(isBootstrapAdmin(BOOTSTRAP_KEY, BOOTSTRAP_KEY)).toBe(true);
    expect(isBootstrapAdmin(REGULAR_KEY, BOOTSTRAP_KEY)).toBe(false);
  });

  it('treats role admin and the bootstrap key as admin', () => {
    expect(isAdminUser(makeUser({ role: 'admin' }), BOOTSTRAP_KEY)).toBe(true);
    expect(isAdminUser(makeUser({ stellarPublicKey: BOOTSTRAP_KEY }), BOOTSTRAP_KEY)).toBe(true);
    expect(isAdminUser(makeUser(), BOOTSTRAP_KEY)).toBe(false);
  });
});

describe('step-up throttle', () => {
  const now = new Date('2026-01-01T00:00:00Z');

  it('increments the failure counter', () => {
    expect(nextThrottleState({ failedAttempts: 0, lockedUntil: null }, now)).toEqual({
      failedAttempts: 1,
      lockedUntil: null,
    });
  });

  it('locks at the failure threshold and resets the counter', () => {
    const state = nextThrottleState({ failedAttempts: MAX_STEP_UP_FAILURES - 1, lockedUntil: null }, now);
    expect(state.failedAttempts).toBe(0);
    expect(state.lockedUntil?.getTime()).toBe(now.getTime() + STEP_UP_LOCKOUT_MS);
  });

  it('honors an active lock', () => {
    const locked = { failedAttempts: 2, lockedUntil: new Date(now.getTime() + 60_000) };
    expect(isLocked(locked.lockedUntil, now)).toBe(true);
    expect(nextThrottleState(locked, now)).toBe(locked);
  });

  it('lets the lock expire', () => {
    const lockedUntil = new Date(now.getTime() + 60_000);
    expect(isLocked(lockedUntil, new Date(now.getTime() + 61_000))).toBe(false);
  });

  it('resets the counter on success', () => {
    expect(resetThrottle()).toEqual({ failedAttempts: 0, lockedUntil: null });
  });
});

describe('verifyTotpCode', () => {
  it('accepts the current authenticator code', async () => {
    const issue = await totpProvider.issue('user@example.com');
    const secret = issue.secret as string;
    const code = generateSync({ secret });
    expect(verifyTotpCode(secret, code)).toBe(true);
  });

  it('rejects a wrong code', async () => {
    const issue = await totpProvider.issue('user@example.com');
    expect(verifyTotpCode(issue.secret as string, '000000')).toBe(false);
  });

  it('rejects a malformed secret', () => {
    expect(verifyTotpCode('not-a-secret', '000000')).toBe(false);
  });
});

describe('promote / demote guards', () => {
  it('promote: unknown target is NOT_FOUND', () => {
    expect(canPromote(undefined)).toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('promote: already admin is CONFLICT', () => {
    expect(canPromote(makeUser({ role: 'admin' }))).toEqual({ ok: false, code: 'CONFLICT' });
  });

  it('promote: regular user is allowed', () => {
    const target = makeUser({ id: 2 });
    expect(canPromote(target)).toEqual({ ok: true, target });
  });

  it('demote: unknown target is NOT_FOUND', () => {
    expect(canDemote(undefined, 1)).toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('demote: non-admin target is CONFLICT', () => {
    expect(canDemote(makeUser({ role: 'user' }), 1)).toEqual({ ok: false, code: 'CONFLICT' });
  });

  it('demote: self-demotion is FORBIDDEN', () => {
    const self = makeUser({ id: 1, role: 'admin' });
    expect(canDemote(self, 1)).toEqual({ ok: false, code: 'FORBIDDEN' });
  });

  it('demote: another admin is allowed', () => {
    const target = makeUser({ id: 2, role: 'admin' });
    expect(canDemote(target, 1)).toEqual({ ok: true, target });
  });
});
