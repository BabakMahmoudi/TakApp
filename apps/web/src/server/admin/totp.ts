import { verifySync } from 'otplib';
import { totpWindow } from '@takapp/shared/verification';

const TOTP_PERIOD_SECONDS = 30;

export function verifyTotpCode(secret: string, code: string): boolean {
  try {
    const result = verifySync({
      secret,
      token: code.replace(/\s+/g, ''),
      epochTolerance: totpWindow * TOTP_PERIOD_SECONDS,
    });
    return result.valid;
  } catch {
    return false;
  }
}
