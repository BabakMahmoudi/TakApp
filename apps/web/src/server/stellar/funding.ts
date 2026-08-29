import { Horizon, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

export interface FundNewAccountParams {
  networkPassphrase: string;
  fundingSecret: string;
  destination: string;
  horizonUrl: string;
}

export type FundingServer = Pick<Horizon.Server, 'loadAccount' | 'submitTransaction'>;

export async function submitCreateAccount(
  server: FundingServer,
  params: Omit<FundNewAccountParams, 'horizonUrl'>,
): Promise<unknown> {
  const funding = Keypair.fromSecret(params.fundingSecret);
  const fundingAccount = await server.loadAccount(funding.publicKey());
  const tx = new TransactionBuilder(fundingAccount, {
    fee: '100',
    networkPassphrase: params.networkPassphrase,
  })
    .addOperation(Operation.createAccount({ destination: params.destination, startingBalance: '1.5' }))
    .setTimeout(30)
    .build();
  tx.sign(funding);
  return server.submitTransaction(tx);
}

export async function fundNewAccount(params: FundNewAccountParams): Promise<unknown> {
  const server = new Horizon.Server(params.horizonUrl);
  try {
    return await submitCreateAccount(server, params);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Account funding failed: ${detail}`);
  }
}
