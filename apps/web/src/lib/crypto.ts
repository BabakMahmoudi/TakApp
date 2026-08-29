const PBKDF2_ITERATIONS = 310_000;
const AES_GCM_IV_LENGTH = 12;

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function generateSalt(): Promise<Uint8Array<ArrayBuffer>> {
  const salt = new Uint8Array(new ArrayBuffer(16));
  crypto.getRandomValues(salt);
  return salt;
}

export async function deriveEncryptionKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptSecret(
  key: CryptoKey,
  secretKey: string,
): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(secretKey),
  );
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

export async function decryptSecret(key: CryptoKey, iv: string, ciphertext: string): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) },
    key,
    fromBase64(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
