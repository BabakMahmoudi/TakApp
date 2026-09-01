import type { D1Database } from '@cloudflare/workers-types';

export interface BotEnv {
  DB: D1Database;
  BOT_TOKEN: string;
  DEEPSEEK_API_KEY: string;
  DEEPSEEK_BASE_URL: string;
  HORIZON_URL: string;
  NETWORK_PASSPHRASE: string;
  TAK_ISSUER_PUBLIC_KEY: string;
  SOROBAN_RPC_URL: string;
  TAK_CONTRACT_ID: string;
  APP_DOMAIN: string;
}
