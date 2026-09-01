import { describe, expect, it } from 'vitest';
import { jwtVerify } from 'jose';
import { issueAdminToken, issueSessionToken } from '../src/server/stellar/session-token';

const SECRET = 'admin-test-secret-that-is-at-least-32-chars';
const OTHER_SECRET = 'another-admin-test-secret-at-least-32-chars';

describe('admin token issuance', () => {
  it('verifies with the admin secret and carries the admin claims', async () => {
    const token = await issueAdminToken({ secret: SECRET, userId: 7, jti: 'jti-1' });
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET));
    expect(payload.typ).toBe('admin');
    expect(payload.iss).toBe('takapp-admin');
    expect(payload.sub).toBe('7');
    expect(payload.jti).toBe('jti-1');
  });

  it('fails verification when signed with a different secret', async () => {
    const token = await issueAdminToken({ secret: SECRET, userId: 7, jti: 'jti-1' });
    await expect(jwtVerify(token, new TextEncoder().encode(OTHER_SECRET))).rejects.toThrow();
  });

  it('session token carries the user typ claim', async () => {
    const publicKey = `G${'A'.repeat(55)}`;
    const token = await issueSessionToken({ secret: SECRET, publicKey, jti: 'jti-2' });
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET));
    expect(payload.typ).toBe('user');
    expect(payload.iss).toBe('takapp');
    expect(payload.sub).toBe(publicKey);
  });
});
