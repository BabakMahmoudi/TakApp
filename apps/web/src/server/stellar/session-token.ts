import { SignJWT } from 'jose';

export interface SessionTokenParams {
  secret: string;
  publicKey: string;
  jti: string;
  ttlSeconds?: number;
}

export async function issueSessionToken(params: SessionTokenParams): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = params.ttlSeconds ?? 3600;
  return new SignJWT({ iss: 'takapp', typ: 'user', sub: params.publicKey, jti: params.jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(new TextEncoder().encode(params.secret));
}

export interface AdminTokenParams {
  secret: string;
  userId: number;
  jti: string;
  ttlSeconds?: number;
}

export async function issueAdminToken(params: AdminTokenParams): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = params.ttlSeconds ?? 900;
  return new SignJWT({ iss: 'takapp-admin', typ: 'admin', sub: String(params.userId), jti: params.jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(new TextEncoder().encode(params.secret));
}
