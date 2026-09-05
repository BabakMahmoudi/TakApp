import { eq } from 'drizzle-orm';
import { importJWK, SignJWT } from 'jose';
import { pushSubscriptions } from '@takapp/shared/db';
import { serializeError } from '../logging';
import type { TrpcContext } from '../trpc/context';

export type PushDb = TrpcContext['db'];

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface PushMessage {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export class PushHttpError extends Error {
  constructor(readonly status: number) {
    super(`Push service responded ${status}`);
    this.name = 'PushHttpError';
  }
}

type Bytes = Uint8Array<ArrayBuffer>;

function base64UrlToBytes(value: string): Bytes {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes: Bytes): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesToBigInt(bytes: Bytes): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function bigIntToBytes(value: bigint, length: number): Bytes {
  const bytes = new Uint8Array(length);
  let remaining = value;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

const P = 2n ** 256n - 2n ** 224n + 2n ** 192n + 2n ** 96n - 1n;
const A = P - 3n;
const GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
const GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;

type Point = readonly [bigint, bigint] | null;

function mod(value: bigint, modulus: bigint = P): bigint {
  const result = value % modulus;
  return result < 0n ? result + modulus : result;
}

function modInverse(value: bigint, modulus: bigint): bigint {
  const a = mod(value, modulus);
  if (a === 0n) throw new Error('No modular inverse');
  let [oldR, r] = [a, modulus];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return mod(oldS, modulus);
}

function pointDouble(point: Exclude<Point, null>): Point {
  if (point[1] === 0n) return null;
  const lambda = mod((3n * point[0] * point[0] + A) * modInverse(2n * point[1], P), P);
  const x = mod(lambda * lambda - 2n * point[0], P);
  const y = mod(lambda * (point[0] - x) - point[1], P);
  return [x, y];
}

function pointAdd(left: Point, right: Exclude<Point, null>): Point {
  if (left === null) return right;
  if (left[0] === right[0]) {
    if (mod(left[1] + right[1]) === 0n) return null;
    return pointDouble(left);
  }
  const lambda = mod((right[1] - left[1]) * modInverse(right[0] - left[0], P), P);
  const x = mod(lambda * lambda - left[0] - right[0], P);
  const y = mod(lambda * (left[0] - x) - left[1], P);
  return [x, y];
}

export function ecPointFromScalar(scalar: bigint): [bigint, bigint] {
  let result: Point = null;
  let addend: Point = [GX, GY];
  let k = scalar;
  while (k > 0n) {
    if (k & 1n) result = pointAdd(result, addend as Exclude<Point, null>);
    addend = pointDouble(addend as Exclude<Point, null>);
    k >>= 1n;
  }
  if (result === null) throw new Error('Scalar out of range');
  return [result[0], result[1]];
}

async function hmacSha256(key: Bytes, data: Bytes): Promise<Bytes> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, data);
  return new Uint8Array(signature);
}

function concatBytes(...arrays: Bytes[]): Bytes {
  const total = arrays.reduce((sum, array) => sum + array.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const array of arrays) {
    output.set(array, offset);
    offset += array.length;
  }
  return output;
}

async function hkdfExpand(prk: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const blocks = Math.ceil(length / 32);
  const output = new Uint8Array(blocks * 32);
  let previous: Bytes = new Uint8Array(0);
  for (let i = 1; i <= blocks; i++) {
    previous = await hmacSha256(prk, concatBytes(previous, info, new Uint8Array([i])));
    output.set(previous, (i - 1) * 32);
  }
  return output.slice(0, length);
}

export async function encryptPayload(
  subscription: { p256dh: string; auth: string },
  plaintext: Bytes,
): Promise<Bytes> {
  const userPublic = base64UrlToBytes(subscription.p256dh);
  const authSecret = base64UrlToBytes(subscription.auth);

  const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const applicationServerPublic = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));

  const userPublicKey = await crypto.subtle.importKey(
    'raw',
    userPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: userPublicKey }, keyPair.privateKey, 256);
  const ecdhSecret = new Uint8Array(sharedBits);

  // RFC 8291 §3.4 stage 1: combine the auth secret and ECDH secret into the
  // input keying material (32 octets) consumed by the RFC 8188 key derivation.
  const prkKey = await hmacSha256(authSecret, ecdhSecret);
  const keyInfo = concatBytes(new TextEncoder().encode('WebPush: info'), new Uint8Array([0]), userPublic, applicationServerPublic);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  // RFC 8188 §2.2/§2.3 stage 2: derive the CEK and nonce from the IKM, keyed by
  // the header salt and the per-purpose info strings.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);
  const cekInfo = concatBytes(new TextEncoder().encode('Content-Encoding: aes128gcm'), new Uint8Array([0]));
  const contentEncryptionKey = await hkdfExpand(prk, cekInfo, 16);
  const nonceInfo = concatBytes(new TextEncoder().encode('Content-Encoding: nonce'), new Uint8Array([0]));
  const nonce = await hkdfExpand(prk, nonceInfo, 12);

  // RFC 8188 §2: append the padding delimiter octet (0x02) for the final record.
  const padded = concatBytes(plaintext, new Uint8Array([0x02]));

  const aesKey = await crypto.subtle.importKey('raw', contentEncryptionKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, padded),
  );

  const recordSize = new Uint8Array([0, 0, 0x10, 0]);
  const keyIdLength = new Uint8Array([65]);
  return concatBytes(salt, recordSize, keyIdLength, applicationServerPublic, ciphertext);
}

export async function createVapidToken(privateKeyB64url: string, audience: string, subject: string): Promise<string> {
  const privateKeyBytes = base64UrlToBytes(privateKeyB64url);
  if (privateKeyBytes.length !== 32) {
    throw new Error('VAPID private key must be a 32-byte P-256 scalar');
  }
  const [x, y] = ecPointFromScalar(bytesToBigInt(privateKeyBytes));
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToBase64Url(bigIntToBytes(x, 32)),
    y: bytesToBase64Url(bigIntToBytes(y, 32)),
    d: privateKeyB64url,
  };
  const key = await importJWK(jwk, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
    .setAudience(audience)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(key);
}

export async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  message: PushMessage,
  vapid: VapidConfig,
): Promise<void> {
  const payload = JSON.stringify({
    title: message.title,
    body: message.body,
    url: message.url ?? '/',
    tag: message.tag ?? message.title,
  });
  const encrypted = await encryptPayload(subscription, new TextEncoder().encode(payload));
  const audience = new URL(subscription.endpoint).origin;
  const token = await createVapidToken(vapid.privateKey, audience, vapid.subject);
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${token}, k=${vapid.publicKey}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
    },
    body: encrypted,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new PushHttpError(response.status);
  }
}

export async function notifyUser(db: PushDb, vapid: VapidConfig, userId: number, message: PushMessage): Promise<void> {
  try {
    const subscriptions = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    console.log(`[push] notifyUser userId=${userId} subscriptions=${subscriptions.length}`);
    for (const subscription of subscriptions) {
      try {
        await sendPushNotification(
          { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth },
          message,
          vapid,
        );
        console.log(`[push] sent OK to subscription ${subscription.id} (${new URL(subscription.endpoint).origin})`);
      } catch (error) {
        if (error instanceof PushHttpError && (error.status === 404 || error.status === 410)) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
          console.log(`[push] deleted stale subscription ${subscription.id}`);
        }
        console.error(`[push] send failed for subscription ${subscription.id}: ${serializeError(error)}`);
      }
    }
  } catch (error) {
    console.error(`[push] notifyUser failed: ${serializeError(error)}`);
  }
}
