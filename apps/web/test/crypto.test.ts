import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  deriveEncryptionKey,
  encryptSecret,
  generateSalt,
} from '../src/lib/crypto';

describe('client crypto', () => {
  it('round-trips a secret key with a derived key', async () => {
    const salt = await generateSalt();
    const key = await deriveEncryptionKey('correct horse battery staple', salt);
    const { iv, ciphertext } = await encryptSecret(key, 'S-EXAMPLE-SECRET-12345');
    await expect(decryptSecret(key, iv, ciphertext)).resolves.toBe('S-EXAMPLE-SECRET-12345');
  });

  it('fails to decrypt with a different password', async () => {
    const salt = await generateSalt();
    const key = await deriveEncryptionKey('correct horse battery staple', salt);
    const wrongKey = await deriveEncryptionKey('wrong password', salt);
    const { iv, ciphertext } = await encryptSecret(key, 'S-EXAMPLE-SECRET-12345');
    await expect(decryptSecret(wrongKey, iv, ciphertext)).rejects.toThrow();
  });

  it('derives different keys from different salts', async () => {
    const saltA = await generateSalt();
    const saltB = await generateSalt();
    const keyA = await deriveEncryptionKey('password', saltA);
    const keyB = await deriveEncryptionKey('password', saltB);
    const { iv, ciphertext } = await encryptSecret(keyA, 'secret');
    await expect(decryptSecret(keyB, iv, ciphertext)).rejects.toThrow();
  });
});
