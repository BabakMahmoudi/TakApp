import {
  Address,
  Contract,
  Horizon,
  TransactionBuilder,
  scValToNative,
} from '@stellar/stellar-sdk/no-axios';
import { Api as SorobanApi, Server as SorobanRpc } from '@stellar/stellar-sdk/no-axios/rpc';
import { stroopsFromLumens, stroopsFromTokenRaw } from '@takapp/shared/money';

export type HorizonServer = Pick<Horizon.Server, 'loadAccount'>;
export type SorobanRpcServer = Pick<SorobanRpc, 'simulateTransaction'>;

export const TAK_DECIMALS = 7;

export interface BalanceEntry {
  asset: 'XLM' | 'TAK';
  stroops: string;
}

export async function fetchBalances(
  server: HorizonServer,
  rpc: SorobanRpcServer,
  publicKey: string,
  takContractId: string,
  networkPassphrase: string,
): Promise<BalanceEntry[]> {
  const account = await server.loadAccount(publicKey);
  const entries: BalanceEntry[] = [];
  for (const balance of account.balances) {
    if (balance.asset_type === 'native') {
      entries.push({ asset: 'XLM', stroops: stroopsFromLumens(balance.balance) });
    }
  }

  const operation = new Contract(takContractId).call('balance', new Address(publicKey).toScVal());
  const transaction = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase,
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
}
