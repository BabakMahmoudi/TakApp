import type { D1Database } from '@cloudflare/workers-types';

export interface WorkerEnv {
  DB: D1Database;
  HORIZON_URL: string;
  NETWORK_PASSPHRASE: string;
  APP_DOMAIN: string;
  JWT_SECRET: string;
  FUNDING_SECRET: string;
  SOROBAN_RPC_URL: string;
  /** Client-facing Horizon base; defaults to same-origin /api/stellar/horizon. */
  HORIZON_PUBLIC_URL?: string;
  /** Client-facing Soroban RPC base; defaults to same-origin /api/stellar/soroban. */
  SOROBAN_PUBLIC_RPC_URL?: string;
  TAK_CONTRACT_ID: string;
  ADMIN_PUBLIC_KEY: string;
  ADMIN_JWT_SECRET: string;
  ADMIN_TOTP_ENC_KEY: string;
  /** Set to "false" to bypass the TOTP step-up when opening the admin panel. */
  ADMIN_TOTP_REQUIRED?: string | boolean;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
}
