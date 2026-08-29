import { Horizon } from '@stellar/stellar-sdk';
import { stroopsFromLumens } from '@takapp/shared/money';

export type HorizonServer = Pick<Horizon.Server, 'loadAccount'>;

export interface BalanceEntry {
  asset: 'XLM' | 'TAK';
  stroops: string;
}

export async function fetchBalances(
  server: HorizonServer,
  publicKey: string,
  takIssuer: string,
): Promise<BalanceEntry[]> {
  const account = await server.loadAccount(publicKey);
  const entries: BalanceEntry[] = [];
  for (const balance of account.balances) {
    if (balance.asset_type === 'native') {
      entries.push({ asset: 'XLM', stroops: stroopsFromLumens(balance.balance) });
    } else if (
      balance.asset_type === 'credit_alphanum4' &&
      balance.asset_code === 'TAK' &&
      balance.asset_issuer === takIssuer
    ) {
      entries.push({ asset: 'TAK', stroops: stroopsFromLumens(balance.balance) });
    }
  }
  return entries;
}

export async function hasTrustline(server: HorizonServer, publicKey: string, takIssuer: string): Promise<boolean> {
  const balances = await fetchBalances(server, publicKey, takIssuer);
  return balances.some((entry) => entry.asset === 'TAK');
}
