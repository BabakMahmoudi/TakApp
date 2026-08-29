import { argon2id } from 'hash-wasm';

const ARGON2_PARAMS = {
  parallelism: 1,
  iterations: 3,
  memorySize: 65536,
  hashLength: 32,
} as const;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await argon2id({
    password,
    salt,
    ...ARGON2_PARAMS,
    outputType: 'binary',
  });
  return [
    'argon2id',
    `v=${19}`,
    `m=${ARGON2_PARAMS.memorySize},t=${ARGON2_PARAMS.iterations},p=${ARGON2_PARAMS.parallelism}`,
    toHex(salt),
    toHex(hash),
  ].join('$');
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, , params, saltHex, hashHex] = encoded.split('$');
  if (algorithm !== 'argon2id' || !params || !saltHex || !hashHex) return false;
  const memorySize = Number(/m=(\d+)/.exec(params)?.[1] ?? ARGON2_PARAMS.memorySize);
  const iterations = Number(/t=(\d+)/.exec(params)?.[1] ?? ARGON2_PARAMS.iterations);
  const parallelism = Number(/p=(\d+)/.exec(params)?.[1] ?? ARGON2_PARAMS.parallelism);
  const hash = await argon2id({
    password,
    salt: fromHex(saltHex),
    memorySize,
    iterations,
    parallelism,
    hashLength: fromHex(hashHex).length,
    outputType: 'binary',
  });
  return toHex(hash) === hashHex;
}
