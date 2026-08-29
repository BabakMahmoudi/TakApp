import { generateSync } from 'otplib';
import { describe, expect, it } from 'vitest';
import { totpProvider } from '../src/verification';

describe('totp provider', () => {
  it('issues a secret and verifies the matching authenticator code', async () => {
    const issue = await totpProvider.issue('user@example.com');
    expect(issue.secret).toBeDefined();
    const code = generateSync({ secret: issue.secret as string });
    await expect(totpProvider.verify('user@example.com', code, issue.secret as string)).resolves.toBe(
      true,
    );
  });

  it('rejects a wrong code and a malformed secret', async () => {
    const issue = await totpProvider.issue('user@example.com');
    await expect(
      totpProvider.verify('user@example.com', '000000', issue.secret as string),
    ).resolves.toBe(false);
    await expect(totpProvider.verify('user@example.com', '123456', 'not-a-secret')).resolves.toBe(
      false,
    );
  });
});
