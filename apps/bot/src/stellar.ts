import { Horizon } from '@stellar/stellar-sdk';
import { stroopsFromLumens } from '@takapp/shared/money';
import type { BotEnv } from './env';

export interface BalanceEntry {
  asset: 'XLM' | 'TAK';
  stroops: string;
}

export interface BalanceReader {
  readBalances(publicKey: string): Promise<BalanceEntry[]>;
}

export function createBalanceReader(env: BotEnv): BalanceReader {
  const server = new Horizon.Server(env.HORIZON_URL);
  return {
    async readBalances(publicKey: string): Promise<BalanceEntry[]> {
      const account = await server.loadAccount(publicKey);
      const entries: BalanceEntry[] = [];
      for (const balance of account.balances) {
        if (balance.asset_type === 'native') {
          entries.push({ asset: 'XLM', stroops: stroopsFromLumens(balance.balance) });
        } else if (
          balance.asset_type === 'credit_alphanum4' &&
          balance.asset_code === 'TAK' &&
          balance.asset_issuer === env.TAK_ISSUER
        ) {
          entries.push({ asset: 'TAK', stroops: stroopsFromLumens(balance.balance) });
        }
      }
      return entries;
    },
  };
}
