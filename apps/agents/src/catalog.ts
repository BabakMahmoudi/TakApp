export type AgentDoBinding = 'TakAppAgent';

export interface AgentEntry {
  className: string;
  /** Durable Object binding name, or null for a deferred/stub agent. */
  binding: AgentDoBinding | null;
}

export const AGENT_CATALOG: Record<string, AgentEntry> = {
  'takapp-agent': { className: 'TakAppAgent', binding: 'TakAppAgent' },
  // Deferred: crypto-market agent (deepseek-v4-pro). No DO binding yet.
  'crypto-market': { className: 'CryptoMarketAgent', binding: null },
};
