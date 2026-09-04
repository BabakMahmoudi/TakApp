import {
  Horizon,
  Keypair,
  Operation,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk/no-axios';
import { isLocalHttpUrl } from '@takapp/shared/url';
import { logHttp, serializeError } from '../logging';

const SUBMIT_TRANSACTION_TIMEOUT_MS = 20_000;

export interface FundNewAccountParams {
  networkPassphrase: string;
  fundingSecret: string;
  destination: string;
  horizonUrl: string;
}

export type FundingServer = Pick<Horizon.Server, 'loadAccount'>;

function horizonErrorDetail(payload: unknown, raw: string): string {
  if (typeof payload === 'object' && payload !== null) {
    const body = payload as Record<string, unknown>;
    if (typeof body.extras === 'object' && body.extras !== null) {
      const resultCodes = (body.extras as Record<string, unknown>).result_codes as Record<string, unknown> | undefined;
      const operations = resultCodes?.operations;
      if (Array.isArray(operations) && operations.length > 0) return operations.join(', ');
    }
    if (typeof body.detail === 'string') return body.detail;
    if (typeof body.title === 'string') return body.title;
  }
  return raw.slice(0, 500);
}

async function submitTransactionToHorizon(horizonUrl: string, tx: Transaction): Promise<unknown> {
  const url = `${horizonUrl.replace(/\/+$/, '')}/transactions`;
  const body = new URLSearchParams({ tx: tx.toXDR() });
  const response = await logHttp('POST', url, () =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(SUBMIT_TRANSACTION_TIMEOUT_MS),
    }),
  );
  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = JSON.parse(text);
  } catch {
    // keep the raw text for the error message
  }
  if (!response.ok) {
    throw new Error(
      `Horizon transaction submission failed (HTTP ${response.status}): ${horizonErrorDetail(payload, text)}`,
    );
  }
  if (typeof payload === 'object' && payload !== null && 'result_xdr' in payload) {
    try {
      xdr.TransactionResult.fromXDR(String((payload as Record<string, unknown>).result_xdr), 'base64');
    } catch (error) {
      console.warn(`[funding] result_xdr parse failed: ${serializeError(error)}`);
    }
  }
  return payload;
}

export { submitTransactionToHorizon };

export async function submitCreateAccount(server: FundingServer, params: FundNewAccountParams): Promise<unknown> {
  const funding = Keypair.fromSecret(params.fundingSecret);
  console.log(`[funding] loadAccount start funding=${funding.publicKey()}`);
  const started = Date.now();
  let fundingAccount;
  try {
    fundingAccount = await server.loadAccount(funding.publicKey());
    console.log(`[funding] loadAccount ok (${Date.now() - started}ms)`);
  } catch (error) {
    const notFound =
      error instanceof Error && (error.message.includes('404') || error.message.includes('not exist'));
    console.error(
      `[funding] loadAccount FAILED (${Date.now() - started}ms) ${notFound ? '(account missing)' : '(network error)'}: ${serializeError(error)}`,
    );
    throw error;
  }
  const tx = new TransactionBuilder(fundingAccount, {
    fee: '100',
    networkPassphrase: params.networkPassphrase,
  })
    .addOperation(
      // Reserve math: a fresh account needs 2 * base_reserve (0.5 XLM).
      // Fund 5 XLM to cover that minimum plus a buffer for transaction fees.
      Operation.createAccount({ destination: params.destination, startingBalance: '5' }),
    )
    .setTimeout(30)
    .build();
  tx.sign(funding);
  console.log(`[funding] submitTransaction start destination=${params.destination}`);
  const submitted = Date.now();
  try {
    const result = await submitTransactionToHorizon(params.horizonUrl, tx);
    console.log(`[funding] submitTransaction ok (${Date.now() - submitted}ms)`);
    return result;
  } catch (error) {
    console.error(
      `[funding] submitTransaction FAILED (${Date.now() - submitted}ms): ${serializeError(error)}`,
    );
    throw error;
  }
}

export async function fundNewAccount(params: FundNewAccountParams): Promise<unknown> {
  const server = new Horizon.Server(params.horizonUrl, { allowHttp: isLocalHttpUrl(params.horizonUrl) });
  // Bail out fast instead of letting a stuck Horizon connection ride until the
  // Worker runtime cancels the whole request as hung. maxRedirects is set to
  // force the SDK's bounded fetch adapter, which actually honors `timeout`.
  server.httpClient.defaults.timeout = 15_000;
  server.httpClient.defaults.maxRedirects = 10;
  console.log(`[funding] funding-account=${Keypair.fromSecret(params.fundingSecret).publicKey()}`);
  const started = Date.now();
  const requestStarted = Symbol.for('__startedAt');
  server.httpClient.interceptors.request.use((config) => {
    (config as unknown as Record<PropertyKey, unknown>)[requestStarted] = Date.now();
    console.log(`[funding] http ${(config.method ?? 'GET').toUpperCase()} ${config.url} start`);
    return config;
  });
  server.httpClient.interceptors.response.use(
    (response) => {
      const start = (response.config?.[requestStarted] as number | undefined) ?? started;
      const method = (response.config?.method ?? 'GET').toUpperCase();
      const url = response.config?.url ?? '(unknown)';
      console.log(`[funding] http ${method} ${url} ok ${response.status} (${Date.now() - start}ms)`);
      return response;
    },
    (error) => {
      const config = error?.response?.config ?? error?.config;
      const start = (config?.[requestStarted] as number | undefined) ?? started;
      const method = (config?.method ?? 'GET').toUpperCase();
      const url = config?.url ?? '(unknown)';
      console.error(`[funding] http ${method} ${url} FAILED (${Date.now() - start}ms): ${serializeError(error)}`);
      throw error;
    },
  );
  try {
    return await submitCreateAccount(server, params);
  } catch (error) {
    console.error(`[funding] failed after ${Date.now() - started}ms: ${serializeError(error)}`);
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Account funding failed: ${detail}`);
  }
}
