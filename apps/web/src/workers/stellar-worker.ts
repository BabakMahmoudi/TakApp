import { sha256 } from '@noble/hashes/sha256';
import { mnemonicToSeed, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { Asset, Horizon, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import type { StellarWorkerRequest, StellarWorkerResponse } from './messages';

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

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
      case 'submit-change-trust': {
        const keypair = Keypair.fromSecret(request.secretKey);
        const server = new Horizon.Server(request.horizonUrl);
        // Bound every Horizon hop so a slow network fails visibly instead of
        // hanging the activation screen forever (mirrors the server-side
        // funding hardening).
        server.httpClient.defaults.timeout = 15_000;
        const account = await server.loadAccount(keypair.publicKey());
        const asset = new Asset(request.assetCode, request.assetIssuer);
        const transaction = new TransactionBuilder(account, {
          fee: '100',
          networkPassphrase: request.networkPassphrase,
        })
          .addOperation(Operation.changeTrust({ asset }))
          .setTimeout(60)
          .build();
        transaction.sign(keypair);
        const url = `${request.horizonUrl.replace(/\/+$/, '')}/transactions`;
        const body = new URLSearchParams({ tx: transaction.toXDR() });
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
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
          const detail =
            typeof payload === 'object' && payload !== null && 'detail' in payload
              ? String((payload as Record<string, unknown>).detail)
              : text;
          throw new Error(`Horizon trustline submission failed (HTTP ${response.status}): ${detail}`);
        }
        const hash =
          typeof payload === 'object' && payload !== null && 'hash' in payload
            ? String((payload as Record<string, unknown>).hash)
            : '';
        respond({ requestId: request.requestId, type: 'submitted', txHash: hash });
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

function respond(response: StellarWorkerResponse): void {
  workerScope.postMessage(response);
}
