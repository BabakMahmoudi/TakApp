import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { Horizon, Keypair } from '@stellar/stellar-sdk/no-axios';
import { Server as SorobanRpc } from '@stellar/stellar-sdk/no-axios/rpc';
import { gifts } from '@takapp/shared/db';
import { compareStroops } from '@takapp/shared/money';
import { isLocalHttpUrl } from '@takapp/shared/url';
import { fetchTakBalance } from '../stellar/horizon';
import { submitTakTransfer } from '../stellar/tak-transfer';
import type { TrpcContext } from '../trpc/context';
import type { WorkerEnv } from '../trpc/env';

type Db = TrpcContext['db'];
type TakEnv = Pick<
  WorkerEnv,
  | 'GAME_ACCOUNT_SECRET'
  | 'HORIZON_URL'
  | 'SOROBAN_RPC_URL'
  | 'NETWORK_PASSPHRASE'
  | 'TAK_CONTRACT_ID'
>;

export const CLAIM_TYPE = 'tak-claim-3';
export const CLAIM_AMOUNT_STROOPS = '30000000';

export type TakErrorCode =
  | 'ALREADY_CLAIMED'
  | 'FAUCET_NOT_READY'
  | 'FAUCET_OUT_OF_FUNDS'
  | 'CLAIM_FAILED';

export class TakFaucetError extends Error {
  constructor(
    message: string,
    public code: TakErrorCode,
  ) {
    super(message);
    this.name = 'TakFaucetError';
  }
}

export function toTrpcTakError(error: TakFaucetError): TRPCError {
  let code: 'NOT_FOUND' | 'BAD_REQUEST' | 'INTERNAL_SERVER_ERROR';
  switch (error.code) {
    case 'ALREADY_CLAIMED':
      code = 'NOT_FOUND';
      break;
    case 'CLAIM_FAILED':
      code = 'INTERNAL_SERVER_ERROR';
      break;
    default:
      code = 'BAD_REQUEST';
      break;
  }
  // The client reads `error.message` as the typed code and maps it to an i18n
  // key via takClaimErrorKey(), mirroring the games error contract.
  return new TRPCError({ code, message: error.code });
}

export async function withTakErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof TakFaucetError) {
      throw toTrpcTakError(error);
    }
    throw error;
  }
}

function getFaucetKeypair(env: TakEnv): Keypair {
  try {
    return Keypair.fromSecret(env.GAME_ACCOUNT_SECRET);
  } catch {
    throw new TakFaucetError('Faucet account is not ready', 'FAUCET_NOT_READY');
  }
}

async function readFaucetTakBalance(env: TakEnv, publicKey: string): Promise<string> {
  const server = new Horizon.Server(env.HORIZON_URL, { allowHttp: isLocalHttpUrl(env.HORIZON_URL) });
  const rpc = new SorobanRpc(env.SOROBAN_RPC_URL, { allowHttp: isLocalHttpUrl(env.SOROBAN_RPC_URL) });
  return fetchTakBalance(server, rpc, publicKey, env.TAK_CONTRACT_ID);
}

export interface ClaimStatus {
  claimed: boolean;
  claimedAt: Date | null;
  amount: string | null;
}

export async function getClaimStatus(db: Db, userId: number): Promise<ClaimStatus> {
  const rows = await db
    .select()
    .from(gifts)
    .where(and(eq(gifts.userId, userId), eq(gifts.type, CLAIM_TYPE)))
    .limit(1);
  const row = rows[0];
  return row
    ? { claimed: true, claimedAt: row.createdAt, amount: row.amount }
    : { claimed: false, claimedAt: null, amount: null };
}

export async function claimTak(
  db: Db,
  env: TakEnv,
  input: { userId: number; stellarPublicKey: string },
): Promise<{ txHash: string; amount: string }> {
  const existing = await db
    .select()
    .from(gifts)
    .where(and(eq(gifts.userId, input.userId), eq(gifts.type, CLAIM_TYPE)))
    .limit(1);
  if (existing.length > 0) {
    throw new TakFaucetError('Already claimed', 'ALREADY_CLAIMED');
  }

  const faucet = getFaucetKeypair(env);
  let faucetBalance: string;
  try {
    faucetBalance = await readFaucetTakBalance(env, faucet.publicKey());
  } catch {
    throw new TakFaucetError('Faucet account is not ready', 'FAUCET_NOT_READY');
  }
  if (compareStroops(faucetBalance, CLAIM_AMOUNT_STROOPS) < 0) {
    throw new TakFaucetError('Faucet is out of funds', 'FAUCET_OUT_OF_FUNDS');
  }

  const createdAt = new Date();
  const [reserved] = await db
    .insert(gifts)
    .values({
      userId: input.userId,
      type: CLAIM_TYPE,
      amount: CLAIM_AMOUNT_STROOPS,
      createdAt,
    })
    .onConflictDoNothing()
    .returning();
  if (!reserved) {
    throw new TakFaucetError('Already claimed', 'ALREADY_CLAIMED');
  }

  try {
    const payout = await submitTakTransfer({
      networkPassphrase: env.NETWORK_PASSPHRASE,
      sourceSecret: env.GAME_ACCOUNT_SECRET,
      destination: input.stellarPublicKey,
      amountStroops: CLAIM_AMOUNT_STROOPS,
      takContractId: env.TAK_CONTRACT_ID,
      horizonUrl: env.HORIZON_URL,
      sorobanRpcUrl: env.SOROBAN_RPC_URL,
    });
    return { txHash: payout.txHash, amount: CLAIM_AMOUNT_STROOPS };
  } catch {
    await db
      .delete(gifts)
      .where(and(eq(gifts.userId, input.userId), eq(gifts.type, CLAIM_TYPE)));
    throw new TakFaucetError('Claim failed', 'CLAIM_FAILED');
  }
}
