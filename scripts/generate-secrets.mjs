import { randomBytes } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';

// Generates the random secret keys needed by TakApp. Print-only: nothing is
// written to disk or to Cloudflare. Copy the values into `wrangler secrets put`
// (never into wrangler.toml or a committed script).
//
//   node scripts/generate-secrets.mjs
//
// Non-pipeable values are supplied as:
//   echo <VALUE> | pnpm exec wrangler secret put NAME --env preview

function randomSecret(label, byteLength, note) {
  const value = randomBytes(byteLength).toString('base64url');
  console.log(`# ${note}`);
  console.log(`${label}=${value}`);
  console.log(`#   echo ${value} | pnpm exec wrangler secret put ${label} --env preview`);
  console.log('');
}

// JWT secrets sign HS256 tokens via jose (TextEncoder of the string); any
// length >= 32 chars works, we use 48 bytes -> 64 base64url chars.
randomSecret('JWT_SECRET', 48, 'signs SEP-10 session JWTs (>= 32 chars)');
randomSecret('ADMIN_JWT_SECRET', 48, 'signs admin step-up JWTs (>= 32 chars)');

// ADMIN_TOTP_ENC_KEY must be exactly 32 ASCII bytes for AES-256-GCM raw key
// import (WebCrypto rejects any other length). 24 bytes -> 32 base64url chars.
randomSecret('ADMIN_TOTP_ENC_KEY', 24, 'AES-256-GCM key for TOTP secrets at rest (exactly 32 bytes)');

// Funding account: a Stellar secret key. Fund the printed public key via
// Friendbot before local smoke tests:
//   curl "https://friendbot.stellar.org?addr=<PUBLIC>"
const funding = Keypair.random();
console.log('# Stellar funding account (fund PUBLIC via Friendbot on testnet)');
console.log(`FUNDING_SECRET=${funding.secret()}`);
console.log(`# FUNDING_PUBLIC=${funding.publicKey()}`);
console.log(`#   echo ${funding.secret()} | pnpm exec wrangler secret put FUNDING_SECRET --env preview`);
