import { describe, expect, it } from 'vitest';
import { decryptTotpSecret, encryptTotpSecret } from '../src/server/admin/totp-enc';

const ENC_KEY = '0123456789abcdef0123456789abcdef';

describe('totp secret encryption', () => {
  it('round-trips a secret', async () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const encrypted = await encryptTotpSecret(secret, ENC_KEY);
    await expect(decryptTotpSecret(encrypted, ENC_KEY)).resolves.toBe(secret);
  });

  it('throws on a tampered ciphertext', async () => {
    const encrypted = await encryptTotpSecret('JBSWY3DPEHPK3PXP', ENC_KEY);
    const separator = encrypted.indexOf(':');
    const ciphertext = encrypted.slice(separator + 1);
    const flipped = (ciphertext[0] === 'A' ? 'B' : 'A') + ciphertext.slice(1);
    const tampered = `${encrypted.slice(0, separator)}:${flipped}`;
    await expect(decryptTotpSecret(tampered, ENC_KEY)).rejects.toThrow();
  });

  it('fails closed on a missing encryption key', async () => {
    await expect(encryptTotpSecret('JBSWY3DPEHPK3PXP', '')).rejects.toThrow();
  });

  it('fails closed on a key shorter than 32 bytes', async () => {
    await expect(encryptTotpSecret('JBSWY3DPEHPK3PXP', 'too-short')).rejects.toThrow();
  });
});
