import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@takapp/shared/password';

describe('password hashing', () => {
  it('hashes and verifies a password round-trip', async () => {
    const encoded = await hashPassword('correct horse battery staple');
    expect(encoded.startsWith('pbkdf2$SHA-256$i=100000$')).toBe(true);
    await expect(verifyPassword('correct horse battery staple', encoded)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const encoded = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('wrong password', encoded)).resolves.toBe(false);
  });

  it('rejects a malformed hash', async () => {
    await expect(verifyPassword('password', 'not-a-valid-hash')).resolves.toBe(false);
  });

  it('verifies hashes stored with a different iteration count', async () => {
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('test'), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1000 }, key, 256);
    const toHex = (bytes: Uint8Array) =>
      Array.from(bytes)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    const encoded = ['pbkdf2', 'SHA-256', 'i=1000', toHex(salt), toHex(new Uint8Array(bits))].join('$');
    await expect(verifyPassword('test', encoded)).resolves.toBe(true);
  });
});
