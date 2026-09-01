import { sha256 } from '@noble/hashes/sha256';
import { mnemonicToSeed, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { Asset, Horizon, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import type { StellarWorkerRequest, StellarWorkerResponse } from './messages';

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

const PAYMENT_MAX_ATTEMPTS = 3;
const PAYMENT_RETRY_DELAY_MS = 2000;

function horizonErrorDetail(payload: unknown, raw: string): string {
  if (typeof payload === 'object' && payload !== null) {
    const body = payload as Record<string, unknown>;
    const extras = body.extras as Record<string, unknown> | undefined;
    const resultCodes = extras?.result_codes as Record<string, unknown> | undefined;
    const operations = resultCodes?.operations;
    if (Array.isArray(operations) && operations.length > 0) return operations.join(', ');
    if (typeof body.detail === 'string') return body.detail;
    if (typeof body.title === 'string') return body.title;
  }
  return raw.slice(0, 500);
}

function isValidLumenAmount(amount: string): boolean {
  return /^[0-9]+(\.[0-9]{1,7})?$/.test(amount);
}

workerScope.onmessage = (event: MessageEvent<StellarWorkerRequest>) => {
  const request = event.data;
  void handle(request);
};

async function handle(request: StellarWorkerRequest): Promise<void> {
  try {
    switch (request.type) {
      case 'generate-keypair': {
        const keypair = Keypair.random();
        respond({
          requestId: request.requestId,
          type: 'keypair',
          publicKey: keypair.publicKey(),
          secretKey: keypair.secret(),
        });
        break;
      }
      case 'derive-from-mnemonic': {
        if (!validateMnemonic(request.mnemonic, wordlist)) {
          throw new Error('Invalid mnemonic');
        }
        const seed = await mnemonicToSeed(request.mnemonic);
        const keypair = Keypair.fromRawEd25519Seed(sha256(seed) as Buffer);
        respond({
          requestId: request.requestId,
          type: 'keypair',
          publicKey: keypair.publicKey(),
          secretKey: keypair.secret(),
        });
        break;
      }
      case 'sign-challenge': {
        const keypair = Keypair.fromSecret(request.secretKey);
        const transaction = TransactionBuilder.fromXDR(request.xdr, request.networkPassphrase);
        transaction.sign(keypair);
        respond({
          requestId: request.requestId,
          type: 'signed-xdr',
          signedXdr: transaction.toXDR(),
        });
        break;
      }
      case 'submit-payment': {
        const keypair = Keypair.fromSecret(request.secretKey);
        if (keypair.publicKey() === request.destination) {
          throw new Error('Cannot send a payment to yourself');
        }
        if (!isValidLumenAmount(request.amount) || /^0+(\.0+)?$/.test(request.amount)) {
          throw new Error('Payment amount must be greater than zero');
        }
        const server = new Horizon.Server(request.horizonUrl);
        server.httpClient.defaults.timeout = 15_000;
        const account = await server.loadAccount(keypair.publicKey());
        const operation = Operation.payment({
          destination: request.destination,
          asset: new Asset('TAK', request.assetIssuer),
          amount: request.amount,
        });
        const transaction = new TransactionBuilder(account, {
          fee: '100',
          networkPassphrase: request.networkPassphrase,
        })
          .addOperation(operation)
          .setTimeout(180)
          .build();
        transaction.sign(keypair);
        const txHash = await submitTransaction(request.horizonUrl, transaction.toXDR());
        respond({ requestId: request.requestId, type: 'submitted', txHash });
        break;
      }
      case 'ensure-trustline': {
        const keypair = Keypair.fromSecret(request.secretKey);
        const server = new Horizon.Server(request.horizonUrl);
        server.httpClient.defaults.timeout = 15_000;
        const account = await server.loadAccount(keypair.publicKey());
        const hasTrustline = account.balances.some(
          (balance) =>
            balance.asset_type === 'credit_alphanum4' &&
            balance.asset_code === 'TAK' &&
            balance.asset_issuer === request.assetIssuer,
        );
        if (hasTrustline) {
          respond({ requestId: request.requestId, type: 'trustline', txHash: null });
          return;
        }
        const operation = Operation.changeTrust({ asset: new Asset('TAK', request.assetIssuer) });
        const transaction = new TransactionBuilder(account, {
          fee: '100',
          networkPassphrase: request.networkPassphrase,
        })
          .addOperation(operation)
          .setTimeout(180)
          .build();
        transaction.sign(keypair);
        const txHash = await submitTransaction(request.horizonUrl, transaction.toXDR());
        respond({ requestId: request.requestId, type: 'trustline', txHash });
        break;
      }
    }
  } catch (error) {
    respond({
      requestId: request.requestId,
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function submitTransaction(horizonUrl: string, xdr: string): Promise<string> {
  const url = `${horizonUrl.replace(/\/+$/, '')}/transactions`;
  // Retry only the HTTP submission, never the build: resubmitting the same XDR
  // after a lost response yields the same tx hash on Horizon, so a retry is
  // idempotent instead of double-spending.
  let lastError: unknown;
  for (let attempt = 0; attempt < PAYMENT_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ tx: xdr }),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await response.text();
      let payload: unknown = text;
      try {
        payload = JSON.parse(text);
      } catch {
        // keep raw text for the error message
      }
      if (!response.ok) {
        // A deterministic rejection (e.g. op_underfunded) will not heal on
        // retry, so surface it immediately.
        throw new Error(
          `Horizon submission failed (HTTP ${response.status}): ${horizonErrorDetail(payload, text)}`,
        );
      }
      return typeof payload === 'object' && payload !== null && 'hash' in payload
        ? String((payload as Record<string, unknown>).hash)
        : '';
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Horizon submission failed')) {
        throw error;
      }
      lastError = error;
      if (attempt < PAYMENT_MAX_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, PAYMENT_RETRY_DELAY_MS));
      }
    }
  }
  throw lastError ?? new Error('Submission failed');
}

function respond(response: StellarWorkerResponse): void {
  workerScope.postMessage(response);
}
