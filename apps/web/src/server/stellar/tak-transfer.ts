import {
  Address,
  Contract,
  Horizon,
  Keypair,
  nativeToScVal,
  TransactionBuilder,
} from '@stellar/stellar-sdk/no-axios';
import {
  Api as SorobanApi,
  assembleTransaction,
  Server as SorobanRpc,
} from '@stellar/stellar-sdk/no-axios/rpc';
import { isLocalHttpUrl } from '@takapp/shared/url';
import { submitTransactionToHorizon } from './funding';
import { serializeError } from '../logging';

export interface SubmitTakTransferParams {
  networkPassphrase: string;
  /** Secret key of the server-held source account (e.g. the casino). */
  sourceSecret: string;
  destination: string;
  /** i128 raw amount, in stroops (string, no floats). */
  amountStroops: string;
  takContractId: string;
  horizonUrl: string;
  sorobanRpcUrl: string;
}

export interface SubmitTakTransferResult {
  txHash: string;
  envelopeXdr: string;
}

/**
 * Builds, signs, and submits a SEP-41 `transfer` from a server-held key to a
 * destination. Mirrors the client Web Worker `submit-payment` flow but runs
 * entirely server-side (used for casino -> winner payouts and admin withdraws).
 */
export async function submitTakTransfer(
  params: SubmitTakTransferParams,
): Promise<SubmitTakTransferResult> {
  const source = Keypair.fromSecret(params.sourceSecret);
  const server = new Horizon.Server(params.horizonUrl, {
    allowHttp: isLocalHttpUrl(params.horizonUrl),
  });
  server.httpClient.defaults.timeout = 15_000;
  server.httpClient.defaults.maxRedirects = 10;
  const rpc = new SorobanRpc(params.sorobanRpcUrl, {
    allowHttp: isLocalHttpUrl(params.sorobanRpcUrl),
  });

  const started = Date.now();
  console.log(`[games] tak-transfer start from=${source.publicKey()} to=${params.destination}`);
  try {
    const account = await server.loadAccount(source.publicKey());
    const operation = new Contract(params.takContractId).call(
      'transfer',
      new Address(source.publicKey()).toScVal(),
      new Address(params.destination).toScVal(),
      nativeToScVal(BigInt(params.amountStroops), { type: 'i128' }),
    );
    const transaction = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: params.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(0)
      .build();
    const simulation = await rpc.simulateTransaction(transaction);
    if (SorobanApi.isSimulationError(simulation)) {
      throw new Error(`TAK transfer simulation failed: ${simulation.error}`);
    }
    if (!simulation.result) {
      throw new Error('TAK transfer simulation returned no result');
    }
    const signed = assembleTransaction(transaction, simulation).build();
    signed.sign(source);
    const txHash = signed.hash().toString('hex');
    await submitTransactionToHorizon(params.horizonUrl, signed);
    console.log(`[games] tak-transfer ok ${txHash} (${Date.now() - started}ms)`);
    return { txHash, envelopeXdr: signed.toXDR() };
  } catch (error) {
    console.error(`[games] tak-transfer FAILED (${Date.now() - started}ms): ${serializeError(error)}`);
    throw error;
  }
}
