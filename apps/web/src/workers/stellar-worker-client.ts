import type { StellarWorkerRequestPayload, StellarWorkerResponse } from './messages';

export interface SignChallengeInput {
  xdr: string;
  secretKey: string;
  networkPassphrase: string;
}

export interface SubmitPaymentInput {
  secretKey: string;
  destination: string;
  amount: string;
  assetIssuer: string;
  horizonUrl: string;
  networkPassphrase: string;
}

export interface EnsureTrustlineInput {
  secretKey: string;
  assetIssuer: string;
  horizonUrl: string;
  networkPassphrase: string;
}

export interface StellarWorkerClient {
  generateKeypair(): Promise<{ publicKey: string; secretKey: string }>;
  deriveFromMnemonic(mnemonic: string): Promise<{ publicKey: string; secretKey: string }>;
  signChallenge(input: SignChallengeInput): Promise<string>;
  submitPayment(input: SubmitPaymentInput): Promise<string>;
  ensureTrustline(input: EnsureTrustlineInput): Promise<string | null>;
  terminate(): void;
}

type Resolver = {
  resolve: (response: StellarWorkerResponse) => void;
  reject: (error: Error) => void;
};

export function createStellarWorkerClient(): StellarWorkerClient {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    throw new Error('The Stellar signing worker is only available in the browser');
  }
  const worker = new Worker(new URL('./stellar-worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<string, Resolver>();

  worker.onmessage = (event: MessageEvent<StellarWorkerResponse>) => {
    const response = event.data;
    const resolver = pending.get(response.requestId);
    if (!resolver) return;
    pending.delete(response.requestId);
    if (response.type === 'error') {
      resolver.reject(new Error(response.message));
    } else {
      resolver.resolve(response);
    }
  };

  worker.onerror = (event) => {
    for (const resolver of pending.values()) resolver.reject(new Error(event.message));
    pending.clear();
  };

  let nextId = 0;
  function send(request: StellarWorkerRequestPayload): Promise<StellarWorkerResponse> {
    const requestId = `req-${nextId++}`;
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      worker.postMessage({ ...request, requestId });
    });
  }

  return {
    async generateKeypair() {
      const response = await send({ type: 'generate-keypair' });
      if (response.type !== 'keypair') throw new Error('Unexpected worker response');
      return { publicKey: response.publicKey, secretKey: response.secretKey };
    },
    async deriveFromMnemonic(mnemonic: string) {
      const response = await send({ type: 'derive-from-mnemonic', mnemonic });
      if (response.type !== 'keypair') throw new Error('Unexpected worker response');
      return { publicKey: response.publicKey, secretKey: response.secretKey };
    },
    async signChallenge(input: SignChallengeInput) {
      const response = await send({ type: 'sign-challenge', ...input });
      if (response.type !== 'signed-xdr') throw new Error('Unexpected worker response');
      return response.signedXdr;
    },
    async submitPayment(input: SubmitPaymentInput) {
      const response = await send({ type: 'submit-payment', ...input });
      if (response.type !== 'submitted') throw new Error('Unexpected worker response');
      return response.txHash;
    },
    async ensureTrustline(input: EnsureTrustlineInput) {
      const response = await send({ type: 'ensure-trustline', ...input });
      if (response.type !== 'trustline') throw new Error('Unexpected worker response');
      return response.txHash;
    },
    terminate() {
      worker.terminate();
    },
  };
}
