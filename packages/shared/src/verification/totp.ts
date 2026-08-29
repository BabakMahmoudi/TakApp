import { generateSecret, verifySync } from 'otplib';
import type { VerificationIssue, VerificationProvider } from './provider';

const CODE_TTL_MS = 30_000;
const WINDOW = 1;

export const totpProvider: VerificationProvider = {
  type: 'totp',

  issue(): Promise<VerificationIssue> {
    return Promise.resolve({ type: 'totp', expiresAt: 0, secret: generateSecret() });
  },

  verify(_identifier: string, code: string, secret: string): Promise<boolean> {
    try {
      return Promise.resolve(verifySync({ secret, token: code.replace(/\s+/g, '') }).valid);
    } catch {
      return Promise.resolve(false);
    }
  },
};

export const totpCodeTtlMs = CODE_TTL_MS;
export const totpWindow = WINDOW;
