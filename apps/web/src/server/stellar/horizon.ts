import { Address, Horizon, scValToNative, xdr } from '@stellar/stellar-sdk/no-axios';
import { Durability, Server as SorobanRpc } from '@stellar/stellar-sdk/no-axios/rpc';
import { stroopsFromLumens, stroopsFromTokenRaw } from '@takapp/shared/money';

export type HorizonServer = Pick<Horizon.Server, 'loadAccount'>;
export type SorobanRpcServer = Pick<SorobanRpc, 'getContractData'>;

export const TAK_DECIMALS = 7;

export interface BalanceEntry {
  asset: 'XLM' | 'TAK';
  stroops: string;
}

function takBalanceKey(publicKey: string): xdr.ScVal {
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('Balance'),
    new Address(publicKey).toScVal(),
  ]);
}

export async function fetchBalances(
  server: HorizonServer,
  rpc: SorobanRpcServer,
  publicKey: string,
  takContractId: string,
): Promise<BalanceEntry[]> {
  const account = await server.loadAccount(publicKey);
  const entries: BalanceEntry[] = [];
  for (const balance of account.balances) {
    if (balance.asset_type === 'native') {
      entries.push({ asset: 'XLM', stroops: stroopsFromLumens(balance.balance) });
    }
  }

  let takStroops = '0';
  try {
    const data = await rpc.getContractData(
      takContractId,
      takBalanceKey(publicKey),
      Durability.Persistent,
    );
    const raw = scValToNative(data.val.contractData().val());
    if (typeof raw === 'bigint') {
      takStroops = stroopsFromTokenRaw(raw, TAK_DECIMALS);
    }
  } catch {
    // TAK is best-effort: a fresh account has no Balance ledger entry and an
    // RPC outage must not blank the XLM read, so both degrade to zero here.
  }
  entries.push({ asset: 'TAK', stroops: takStroops });
  return entries;
}
