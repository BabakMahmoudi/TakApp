import type { D1Database } from '@cloudflare/workers-types';

export interface WorkerEnv {
  DB: D1Database;
  HORIZON_URL: string;
  NETWORK_PASSPHRASE: string;
  APP_DOMAIN: string;
  JWT_SECRET: string;
  FUNDING_SECRET: string;
  TAK_ISSUER_PUBLIC_KEY: string;
  SOROBAN_RPC_URL: string;
  TAK_CONTRACT_ID: string;
  ADMIN_PUBLIC_KEY: string;
  ADMIN_JWT_SECRET: string;
  ADMIN_TOTP_ENC_KEY: string;
  /** Set to "false" to bypass the TOTP step-up when opening the admin panel. */
  ADMIN_TOTP_REQUIRED?: string | boolean;
}
