const ENC_KEY_LENGTH = 32;
const IV_LENGTH = 12;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importEncryptionKey(key: string): Promise<CryptoKey> {
  if (!key) {
    throw new Error('ADMIN_TOTP_ENC_KEY is not configured');
  }
  const material = new TextEncoder().encode(key);
  if (material.length < ENC_KEY_LENGTH) {
    throw new Error('ADMIN_TOTP_ENC_KEY must be exactly 32 bytes');
  }
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptTotpSecret(secret: string, key: string): Promise<string> {
  const cryptoKey = await importEncryptionKey(key);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, new TextEncoder().encode(secret));
  return `${toBase64(iv)}:${toBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptTotpSecret(payload: string, key: string): Promise<string> {
  const cryptoKey = await importEncryptionKey(key);
  const separator = payload.indexOf(':');
  if (separator <= 0) {
    throw new Error('Malformed encrypted TOTP secret');
  }
  const iv = fromBase64(payload.slice(0, separator));
  const ciphertext = fromBase64(payload.slice(separator + 1));
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext);
  return new TextDecoder().decode(plaintext);
}
