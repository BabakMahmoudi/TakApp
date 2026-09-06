import { describe, expect, it } from 'vitest';
import { jwtVerify } from 'jose';
import {
  DEFAULT_SESSION_TTL_SECONDS,
  issueSessionToken,
  parseTtlSeconds,
} from '../src/server/stellar/session-token';
import { buildCaller, errorCode } from './helpers/caller';
import { MockDb } from './helpers/mock-db';

const SECRET = 'session-test-secret-that-is-at-least-32-chars';
const PUBLIC_KEY = `G${'A'.repeat(55)}`;

describe('parseTtlSeconds', () => {
  it('returns the fallback for undefined, empty, and invalid values', () => {
    expect(parseTtlSeconds(undefined, 42)).toBe(42);
    expect(parseTtlSeconds('', 42)).toBe(42);
    expect(parseTtlSeconds('abc', 42)).toBe(42);
    expect(parseTtlSeconds('0', 42)).toBe(42);
    expect(parseTtlSeconds('-5', 42)).toBe(42);
  });

  it('parses a valid positive integer', () => {
    expect(parseTtlSeconds('2592000', 42)).toBe(2592000);
  });
});

describe('issueSessionToken', () => {
  it('uses the default TTL when none is provided', async () => {
    const token = await issueSessionToken({ secret: SECRET, publicKey: PUBLIC_KEY, jti: 'jti-default' });
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET));
    expect(payload.exp! - payload.iat!).toBe(DEFAULT_SESSION_TTL_SECONDS);
  });

  it('respects an explicit TTL', async () => {
    const token = await issueSessionToken({
      secret: SECRET,
      publicKey: PUBLIC_KEY,
      jti: 'jti-ttl',
      ttlSeconds: 900,
    });
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET));
    expect(payload.exp! - payload.iat!).toBe(900);
  });
});

describe('protected procedures with an expired session', () => {
  it('rejects an expired session token', async () => {
    const caller = await buildCaller(new MockDb({}), PUBLIC_KEY, {}, -10);
    expect(await errorCode(caller.users.me())).toBe('UNAUTHORIZED');
  });
});
