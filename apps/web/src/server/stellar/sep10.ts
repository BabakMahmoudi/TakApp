import { Keypair, WebAuth } from '@stellar/stellar-sdk';

export interface ChallengeParams {
  serverSecret: string;
  clientAccountId: string;
  networkPassphrase: string;
  domainName: string;
}

export interface VerifyParams extends ChallengeParams {
  signedXdr: string;
}

const CHALLENGE_TIMEOUT_SECONDS = 300;

export function buildChallengeXdr(params: ChallengeParams): string {
  const server = Keypair.fromSecret(params.serverSecret);
  return WebAuth.buildChallengeTx(
    server,
    params.clientAccountId,
    params.domainName,
    CHALLENGE_TIMEOUT_SECONDS,
    params.networkPassphrase,
    params.domainName,
  );
}

export function verifyChallengeXdr(params: VerifyParams): void {
  const serverPublicKey = Keypair.fromSecret(params.serverSecret).publicKey();
  WebAuth.readChallengeTx(
    params.signedXdr,
    serverPublicKey,
    params.networkPassphrase,
    params.domainName,
    params.domainName,
  );
  const signers = WebAuth.verifyChallengeTxSigners(
    params.signedXdr,
    serverPublicKey,
    params.networkPassphrase,
    [params.clientAccountId],
    params.domainName,
    params.domainName,
  );
  if (signers.length === 0) {
    throw new Error('Challenge is not signed by the client key');
  }
}
