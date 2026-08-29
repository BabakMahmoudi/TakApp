import type { D1Database } from '@cloudflare/workers-types';

export interface WorkerEnv {
  DB: D1Database;
  HORIZON_URL: string;
  NETWORK_PASSPHRASE: string;
  APP_DOMAIN: string;
  JWT_SECRET: string;
  FUNDING_SECRET: string;
  TAK_ISSUER: string;
}

export const TAK_ASSET_CODE = 'TAK';
