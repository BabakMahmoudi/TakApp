// Server-side password hashing via Web Crypto PBKDF2. hash-wasm's argon2 was
// abandoned because it JIT-compiles WASM at runtime, which the Cloudflare
// Workers (workerd) embedder disallows, and pure-JS argon2 blocks the workerd
// event loop (no async yielding) until the runtime kills the request.
// PBKDF2-HMAC-SHA256 via crypto.subtle is native and non-blocking on Workers;
// 600,000 iterations is the OWASP recommendation for PBKDF2-HMAC-SHA256, but
// the workerd embedder caps PBKDF2 at 100,000 iterations and throws otherwise,
// so we use the runtime maximum.
const PBKDF2 = {
  algorithm: 'SHA-256',
  iterations: 100_000,
  saltLength: 16,
  keyLength: 32,
} as const;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: PBKDF2.algorithm, salt, iterations },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2.saltLength));
  const hash = await derive(password, salt, PBKDF2.iterations, PBKDF2.keyLength);
  return [
    'pbkdf2',
    PBKDF2.algorithm,
    `i=${PBKDF2.iterations}`,
    toHex(salt),
    toHex(hash),
  ].join('$');
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, hashName, params, saltHex, hashHex] = encoded.split('$');
  if (algorithm !== 'pbkdf2' || hashName !== PBKDF2.algorithm || !params || !saltHex || !hashHex) return false;
  const iterations = Number(/i=(\d+)/.exec(params)?.[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  const hash = await derive(password, fromHex(saltHex), iterations, fromHex(hashHex).length);
  return toHex(hash) === hashHex;
}
