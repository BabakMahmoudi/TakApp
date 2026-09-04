export type StellarWorkerRequestPayload =
  | { type: 'generate-keypair' }
  | { type: 'derive-from-mnemonic'; mnemonic: string }
  | { type: 'sign-challenge'; xdr: string; secretKey: string; networkPassphrase: string }
  | {
      type: 'submit-payment';
      secretKey: string;
      destination: string;
      contractId: string;
      amountRaw: string;
      rpcUrl: string;
      horizonUrl: string;
      networkPassphrase: string;
    };

export type StellarWorkerRequest = StellarWorkerRequestPayload & { requestId: string };

export type StellarWorkerResponse =
  | { requestId: string; type: 'keypair'; publicKey: string; secretKey: string }
  | { requestId: string; type: 'signed-xdr'; signedXdr: string }
  | { requestId: string; type: 'submitted'; txHash: string }
  | { requestId: string; type: 'error'; message: string };
