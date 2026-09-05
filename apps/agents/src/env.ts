import type { D1Database } from '@cloudflare/workers-types';
import type { AgentNamespace } from 'agents';
import type { TakAppAgent } from './agents/takapp-agent';

export interface AgentEnv {
  DB: D1Database;
  TakAppAgent: AgentNamespace<TakAppAgent>;
  DEEPSEEK_API_KEY: string;
  DEEPSEEK_BASE_URL: string;
  HORIZON_URL: string;
  NETWORK_PASSPHRASE: string;
  SOROBAN_RPC_URL: string;
  TAK_CONTRACT_ID: string;
  APP_DOMAIN: string;
  AGENTS_INTERNAL_TOKEN: string;
}
