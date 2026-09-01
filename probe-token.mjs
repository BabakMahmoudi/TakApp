import { SignJWT } from 'jose';

const secret = 'dev-only-insecure-jwt-secret-please-change';
const publicKey = 'GCGXCQE7UE5RLKAN2SLJLWAGXWE4MR3VUUUOHBVWJOOA2HKUQTJGKV5P';
const now = Math.floor(Date.now() / 1000);
const token = await new SignJWT({ iss: 'takapp', typ: 'user', sub: publicKey, jti: 'probe-' + now })
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt(now)
  .setExpirationTime(now + 3600)
  .sign(new TextEncoder().encode(secret));
console.log(token);
