import {
  Address,
  Contract,
  Horizon,
  TransactionBuilder,
  scValToNative,
} from '@stellar/stellar-sdk/no-axios';
import { Api as SorobanApi, Server as SorobanRpc } from '@stellar/stellar-sdk/no-axios/rpc';
import { stroopsFromLumens, stroopsFromTokenRaw } from '@takapp/shared/money';
import type { BotEnv } from './env';

export const TAK_DECIMALS = 7;

export interface BalanceEntry {
  asset: 'XLM' | 'TAK';
  stroops: string;
}

export interface BalanceReader {
  readBalances(publicKey: string): Promise<BalanceEntry[]>;
}

export function createBalanceReader(env: BotEnv): BalanceReader {
  const server = new Horizon.Server(env.HORIZON_URL);
  const rpc = new SorobanRpc(env.SOROBAN_RPC_URL);
  return {
    async readBalances(publicKey: string): Promise<BalanceEntry[]> {
      const account = await server.loadAccount(publicKey);
      const entries: BalanceEntry[] = [];
      for (const balance of account.balances) {
        if (balance.asset_type === 'native') {
          entries.push({ asset: 'XLM', stroops: stroopsFromLumens(balance.balance) });
        }
      }

      const operation = new Contract(env.TAK_CONTRACT_ID).call(
        'balance',
        new Address(publicKey).toScVal(),
      );
      const transaction = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: env.NETWORK_PASSPHRASE,
      })
        .addOperation(operation)
        .setTimeout(0)
        .build();
      const simulation = await rpc.simulateTransaction(transaction);
      if (SorobanApi.isSimulationError(simulation)) {
        throw new Error(`TAK balance simulation failed: ${simulation.error}`);
      }
      if (!simulation.result) {
        throw new Error('TAK balance simulation returned no result');
      }
      const raw = scValToNative(simulation.result.retval);
      if (typeof raw !== 'bigint') {
        throw new Error(`Unexpected TAK balance return value: ${String(raw)}`);
      }
      entries.push({ asset: 'TAK', stroops: stroopsFromTokenRaw(raw, TAK_DECIMALS) });
      return entries;
    },
  };
}
