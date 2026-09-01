const WALLET_DB_NAME = 'takapp';
const WALLET_STORE = 'wallet';
const WALLET_RECORD_KEY = 'encrypted-secret';
const SESSION_TOKEN_KEY = 'takapp.session.token';
const SESSION_PUBLIC_KEY_KEY = 'takapp.session.publicKey';
const ADMIN_TOKEN_KEY = 'takapp.session.adminToken';

export interface WalletRecord {
  encryptedSecret: string;
  iv: string;
  salt: string;
  publicKey: string;
  mnemonic: string;
}

export interface SessionRecord {
  token: string;
  publicKey: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WALLET_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(WALLET_STORE)) {
        request.result.createObjectStore(WALLET_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WALLET_STORE, mode);
    const request = fn(tx.objectStore(WALLET_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveWallet(record: WalletRecord): Promise<void> {
  await withStore('readwrite', (store) => store.put(record, WALLET_RECORD_KEY));
}

export async function getWallet(): Promise<WalletRecord | null> {
  return (await withStore('readonly', (store) => store.get(WALLET_RECORD_KEY))) ?? null;
}

export async function clearWallet(): Promise<void> {
  await withStore('readwrite', (store) => store.delete(WALLET_RECORD_KEY));
}

export function saveSession(session: SessionRecord): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(SESSION_TOKEN_KEY, session.token);
  localStorage.setItem(SESSION_PUBLIC_KEY_KEY, session.publicKey);
}

export function getSession(): SessionRecord | null {
  if (typeof localStorage === 'undefined') return null;
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  const publicKey = localStorage.getItem(SESSION_PUBLIC_KEY_KEY);
  return token && publicKey ? { token, publicKey } : null;
}

export function getSessionToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(SESSION_TOKEN_KEY);
}

export function clearSession(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(SESSION_TOKEN_KEY);
  localStorage.removeItem(SESSION_PUBLIC_KEY_KEY);
}

export function saveAdminToken(token: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function getAdminToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function clearAdminToken(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}
