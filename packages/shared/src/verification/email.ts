import { sha256Hex } from './digest';
import type { VerificationIssue, VerificationProvider } from './provider';

const CODE_TTL_MS = 10 * 60 * 1000;

function randomCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function createStubProvider(type: 'email' | 'sms'): VerificationProvider {
  return {
    type,

    async issue(): Promise<VerificationIssue> {
      const code = randomCode();
      console.warn(
        `[stub:${type}] verification code for delivery is ${code}; wire up a real provider before production`,
      );
      return {
        type,
        expiresAt: Date.now() + CODE_TTL_MS,
        codeDigest: await sha256Hex(code),
      };
    },

    async verify(_identifier: string, code: string, credential: string): Promise<boolean> {
      return (await sha256Hex(code)) === credential;
    },
  };
}

export const emailProvider: VerificationProvider = createStubProvider('email');
export const smsProvider: VerificationProvider = createStubProvider('sms');
