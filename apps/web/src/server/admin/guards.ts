import type { User } from '@takapp/shared/db';

export const MAX_STEP_UP_FAILURES = 5;
export const STEP_UP_LOCKOUT_MS = 15 * 60 * 1000;

export interface ThrottleState {
  failedAttempts: number;
  lockedUntil: Date | null;
}

export function isBootstrapAdmin(publicKey: string, envAdminKey: string): boolean {
  return publicKey === envAdminKey;
}

export function isAdminUser(user: Pick<User, 'role' | 'stellarPublicKey'>, envAdminKey: string): boolean {
  return user.role === 'admin' || isBootstrapAdmin(user.stellarPublicKey, envAdminKey);
}

export function isLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && now.getTime() < lockedUntil.getTime();
}

export function nextThrottleState(current: ThrottleState, now: Date): ThrottleState {
  if (isLocked(current.lockedUntil, now)) {
    return current;
  }
  const failedAttempts = current.failedAttempts + 1;
  if (failedAttempts >= MAX_STEP_UP_FAILURES) {
    return { failedAttempts: 0, lockedUntil: new Date(now.getTime() + STEP_UP_LOCKOUT_MS) };
  }
  return { failedAttempts, lockedUntil: null };
}

export function resetThrottle(): ThrottleState {
  return { failedAttempts: 0, lockedUntil: null };
}

export type PromoteGuard = { ok: true; target: User } | { ok: false; code: 'NOT_FOUND' | 'CONFLICT' };

export function canPromote(target: User | undefined): PromoteGuard {
  if (!target) return { ok: false, code: 'NOT_FOUND' };
  if (target.role === 'admin') return { ok: false, code: 'CONFLICT' };
  return { ok: true, target };
}

export type DemoteGuard = { ok: true; target: User } | { ok: false; code: 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN' };

export function canDemote(target: User | undefined, actorId: number): DemoteGuard {
  if (!target) return { ok: false, code: 'NOT_FOUND' };
  if (target.role !== 'admin') return { ok: false, code: 'CONFLICT' };
  if (target.id === actorId) return { ok: false, code: 'FORBIDDEN' };
  return { ok: true, target };
}
