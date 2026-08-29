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
        const result = await server.submitTransaction(transaction);
        respond({ requestId: request.requestId, type: 'submitted', txHash: result.hash });
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
