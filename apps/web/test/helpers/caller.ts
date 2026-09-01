import type { D1Database } from '@cloudflare/workers-types';
import type { TrpcContext } from '../../src/server/trpc/context';
import type { WorkerEnv } from '../../src/server/trpc/env';
import { appRouter } from '../../src/server/trpc/router';
import { issueSessionToken } from '../../src/server/stellar/session-token';
import type { MockDb } from './mock-db';

export const testEnv: WorkerEnv = {
  DB: {} as D1Database,
  HORIZON_URL: 'https://horizon-testnet.stellar.org',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  APP_DOMAIN: 'takapp.dev',
  JWT_SECRET: 'test-jwt-secret',
  FUNDING_SECRET: 'test-funding-secret',
  TAK_ISSUER_PUBLIC_KEY: 'GD34LHPQRSZKJGTDSTAFHLTJ4AOS77JEAVMXVITLEI2XYCNSH64SIGRM',
  SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
  TAK_CONTRACT_ID: 'CBI3WR5NQZUQ5PAPV4TBCOFMJ3MOJVZVMH5CKCGVOP63YV2SPFZN3Z7C',
  ADMIN_PUBLIC_KEY: `G${'A'.repeat(55)}`,
  ADMIN_JWT_SECRET: 'test-admin-jwt-secret',
  ADMIN_TOTP_ENC_KEY: 'test-totp-enc-key',
};

const callerFactory = appRouter.createCaller;

export async function buildCaller(db: MockDb, publicKey: string, overrides: Partial<WorkerEnv> = {}) {
  const token = await issueSessionToken({
    secret: testEnv.JWT_SECRET,
    publicKey,
    jti: `test-${Math.random().toString(36).slice(2)}`,
  });
  const context: TrpcContext = {
    db: db as unknown as TrpcContext['db'],
    env: { ...testEnv, ...overrides },
    req: new Request('http://localhost', { headers: { authorization: `Bearer ${token}` } }),
    reqId: 'test',
  };
  return callerFactory(context);
}

export async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code) return code;
    return (error as { data?: { code?: string } }).data?.code;
  }
}
