import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { importJWK, jwtVerify } from 'jose';
import { createVapidToken, ecPointFromScalar, encryptPayload } from '../src/server/push/web-push';

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

async function hmacSha256(key: Bytes, data: Bytes): Promise<Bytes> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, data));
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

async function decryptPayload(
  encrypted: Bytes,
  subscription: { p256dh: string; auth: string; privateKey: CryptoKey },
): Promise<string> {
  const salt = encrypted.slice(0, 16);
  const applicationServerPublic = encrypted.slice(21, 86);
  const ciphertext = encrypted.slice(86);
  const userPublic = base64UrlToBytes(subscription.p256dh);
  const authSecret = base64UrlToBytes(subscription.auth);

  const asPublicKey = await crypto.subtle.importKey(
    'raw',
    applicationServerPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: asPublicKey },
    subscription.privateKey,
    256,
  );

  const prkKey = await hmacSha256(authSecret, new Uint8Array(sharedBits));
  const keyInfo = concatBytes(
    new TextEncoder().encode('WebPush: info'),
    new Uint8Array([0]),
    userPublic,
    applicationServerPublic,
  );
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  const prk = await hmacSha256(salt, ikm);
  const cekInfo = concatBytes(new TextEncoder().encode('Content-Encoding: aes128gcm'), new Uint8Array([0]));
  const cek = await hkdfExpand(prk, cekInfo, 16);
  const nonceInfo = concatBytes(new TextEncoder().encode('Content-Encoding: nonce'), new Uint8Array([0]));
  const nonce = await hkdfExpand(prk, nonceInfo, 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
  const decrypted = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, ciphertext),
  );

  let end = decrypted.length;
  while (end > 0 && decrypted[end - 1] === 0) end -= 1;
  return new TextDecoder().decode(decrypted.slice(0, end - 1));
}

describe('web push', () => {
  it('derives the P-256 public point from a private scalar', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const [x, y] = ecPointFromScalar(BigInt(`0x${Buffer.from(jwk.d as string, 'base64url').toString('hex')}`));
    expect(x.toString(16).padStart(64, '0')).toBe(Buffer.from(jwk.x as string, 'base64url').toString('hex'));
    expect(y.toString(16).padStart(64, '0')).toBe(Buffer.from(jwk.y as string, 'base64url').toString('hex'));
  });

  it('produces a VAPID JWT verifiable with the matching public key', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const token = await createVapidToken(privateJwk.d as string, 'https://push.example.com', 'mailto:test@takapp.dev');
    const publicKey = await importJWK(
      { kty: 'EC', crv: 'P-256', x: privateJwk.x as string, y: privateJwk.y as string },
      'ES256',
    );
    const { payload } = await jwtVerify(token, publicKey, { algorithms: ['ES256'] });
    expect(payload.aud).toBe('https://push.example.com');
    expect(payload.sub).toBe('mailto:test@takapp.dev');
  });

  it('encrypts a payload that round-trips back to the plaintext', async () => {
    const subscriptionPair = (await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    )) as CryptoKeyPair;
    const userPublic = new Uint8Array(await crypto.subtle.exportKey('raw', subscriptionPair.publicKey));
    const authSecret = crypto.getRandomValues(new Uint8Array(16));
    const subscription = { p256dh: bytesToBase64Url(userPublic), auth: bytesToBase64Url(authSecret) };

    const plaintext = 'hello coffee';
    const encrypted = await encryptPayload(subscription, new TextEncoder().encode(plaintext));

    expect(encrypted[20]).toBe(65);
    expect(encrypted.length).toBeGreaterThan(86);

    const decrypted = await decryptPayload(encrypted, { ...subscription, privateKey: subscriptionPair.privateKey });
    expect(decrypted).toBe(plaintext);
  });

  it('matches the RFC 8291 key derivation test vector', () => {
    const nodeHmac = (key: Uint8Array, data: Uint8Array): Bytes =>
      new Uint8Array(createHmac('sha256', key).update(data).digest());

    const authSecret = base64UrlToBytes('BTBZMqHH6r4Tts7J_aSIgg');
    const uaPublic = base64UrlToBytes('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4');
    const asPublic = base64UrlToBytes('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
    const ecdhSecret = base64UrlToBytes('kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs');
    const salt = base64UrlToBytes('DGv6ra1nlYgDCS1FRnbzlw');

    const prkKey = nodeHmac(authSecret, ecdhSecret);
    expect(bytesToBase64Url(prkKey)).toBe('Snr3JMxaHVDXHWJn5wdC52WjpCtd2EIEGBykDcZW32k');

    const keyInfo = concatBytes(new TextEncoder().encode('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic);
    const ikm = nodeHmac(prkKey, concatBytes(keyInfo, new Uint8Array([1])));
    expect(bytesToBase64Url(ikm)).toBe('S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg');

    const prk = nodeHmac(salt, ikm);
    expect(bytesToBase64Url(prk)).toBe('09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc');

    const cekInfo = concatBytes(new TextEncoder().encode('Content-Encoding: aes128gcm'), new Uint8Array([0]));
    const cek = nodeHmac(prk, concatBytes(cekInfo, new Uint8Array([1]))).slice(0, 16);
    expect(bytesToBase64Url(cek)).toBe('oIhVW04MRdy2XN9CiKLxTg');

    const nonceInfo = concatBytes(new TextEncoder().encode('Content-Encoding: nonce'), new Uint8Array([0]));
    const nonce = nodeHmac(prk, concatBytes(nonceInfo, new Uint8Array([1]))).slice(0, 12);
    expect(bytesToBase64Url(nonce)).toBe('4h_95klXJ5E_qnoN');
  });
});
