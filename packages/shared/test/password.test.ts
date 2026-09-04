import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/password';

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const encoded = await hashPassword('correct horse battery staple');
    expect(encoded.startsWith('pbkdf2$SHA-256$i=100000$')).toBe(true);
    await expect(verifyPassword('correct horse battery staple', encoded)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const encoded = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('wrong password', encoded)).resolves.toBe(false);
  });

  it('rejects a tampered hash string', async () => {
    await expect(verifyPassword('password', 'pbkdf2$bogus')).resolves.toBe(false);
  });
});
