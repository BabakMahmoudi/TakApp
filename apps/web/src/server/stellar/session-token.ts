import { SignJWT } from 'jose';

export const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export function parseTtlSeconds(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export interface SessionTokenParams {
  secret: string;
  publicKey: string;
  jti: string;
  ttlSeconds?: number;
}

export async function issueSessionToken(params: SessionTokenParams): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = params.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
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
