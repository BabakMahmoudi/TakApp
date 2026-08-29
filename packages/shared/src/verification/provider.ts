export type VerificationType = 'email' | 'sms' | 'totp';

export interface VerificationIssue {
  type: VerificationType;
  expiresAt: number;
  /** TOTP setup secret; only set for the totp provider. */
  secret?: string;
  /** SHA-256 hex digest of the one-time code; set for stubbed email/sms providers. */
  codeDigest?: string;
}

export interface VerificationProvider {
  readonly type: VerificationType;
  issue(identifier: string): Promise<VerificationIssue>;
  verify(identifier: string, code: string, credential: string): Promise<boolean>;
}
