'use client';

import { useRef, useState } from 'react';
import { decryptSecret, deriveEncryptionKey, encryptSecret, fromBase64, generateSalt, toBase64 } from '../lib/crypto';
import { generateMnemonicPhrase, isValidMnemonicPhrase } from '../lib/recovery';
import { getWallet, saveWallet } from '../lib/storage';
import { trpc } from '../lib/trpc/trpc';
import { useStellarWorker, useWallet } from '../lib/wallet-provider';

type Phase = 'welcome' | 'signup' | 'mnemonic' | 'login';
type ErrorMessage = { message: string } | null;

export default function AuthFlow() {
  const { completeLogin } = useWallet();
  const [phase, setPhase] = useState<Phase>('welcome');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorMessage>(null);

  const flowRef = useRef<{ publicKey: string; secretKey: string; mnemonic: string } | null>(null);
  const credentialsRef = useRef<{ email: string; password: string } | null>(null);
  const worker = useStellarWorker();

  const signupMutation = trpc.auth.signup.useMutation();
  const challengeMutation = trpc.auth.challenge.useMutation();
  const loginMutation = trpc.auth.login.useMutation();
  const clientLogMutation = trpc.auth.clientLog.useMutation();

  function beacon(message: string): void {
    void clientLogMutation.mutateAsync({ message }).catch(() => undefined);
  }

  async function runSignup(email: string, password: string): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const mnemonic = generateMnemonicPhrase();
      if (!isValidMnemonicPhrase(mnemonic)) throw new Error('Failed to generate a valid mnemonic');
      // Derive the keypair from the mnemonic so a future recovery from these
      // 12 words reproduces the exact same account that was registered.
      const { publicKey, secretKey } = await worker().deriveFromMnemonic(mnemonic);
      flowRef.current = { publicKey, secretKey, mnemonic };
      credentialsRef.current = { email, password };
      setPhase('mnemonic');
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy(false);
    }
  }

  async function confirmMnemonic(): Promise<void> {
    const flow = flowRef.current;
    const credentials = credentialsRef.current;
    if (!flow || !credentials) return;
    setError(null);
    setBusy(true);
    try {
      const salt = await generateSalt();
      const key = await deriveEncryptionKey(credentials.password, salt);
      const { iv, ciphertext } = await encryptSecret(key, flow.secretKey);
      await saveWallet({
        encryptedSecret: ciphertext,
        iv,
        salt: toBase64(salt),
        publicKey: flow.publicKey,
        mnemonic: flow.mnemonic,
      });
      await signupMutation.mutateAsync({
        email: credentials.email,
        password: credentials.password,
        publicKey: flow.publicKey,
      });
      await runLogin(credentials.password, flow.publicKey);
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy(false);
    }
  }

  async function runLogin(password: string, publicKeyOverride?: string): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const wallet = await getWallet();
      if (!wallet) throw new Error('No wallet found on this device');
      const publicKey = publicKeyOverride ?? wallet.publicKey;
      beacon(`login: start publicKey=${publicKey.slice(0, 6)}`);
      const challenge = await challengeMutation.mutateAsync({ publicKey });
      const key = await deriveEncryptionKey(password, fromBase64(wallet.salt));
      const secretKey = await decryptSecret(key, wallet.iv, wallet.encryptedSecret);
      const signedXdr = await worker().signChallenge({
        xdr: challenge.challengeXdr,
        secretKey,
        networkPassphrase: challenge.networkPassphrase,
      });
      const result = await loginMutation.mutateAsync({
        publicKey,
        challengeXdr: challenge.challengeXdr,
        signedXdr,
        nonce: challenge.nonce,
      });
      beacon('login: ok');
      completeLogin(result.token, publicKey, secretKey);
    } catch (cause) {
      beacon(`login: failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      setError({ message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'mnemonic') {
    const words = flowRef.current?.mnemonic.split(' ') ?? [];
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
        <h1 className="text-xl font-semibold text-coffee-200">Your recovery phrase</h1>
        <p className="text-sm text-coffee-300">
          Write these 12 words down and keep them safe. They can restore your wallet on any device.
        </p>
        <ol className="grid grid-cols-2 gap-2">
          {words.map((word, index) => (
            <li key={`${word}-${index}`} className="rounded-md bg-coffee-900 px-3 py-2 font-mono text-coffee-100">
              {index + 1}. {word}
            </li>
          ))}
        </ol>
        <button
          onClick={() => void confirmMnemonic()}
          disabled={busy}
          className="rounded-md bg-coffee-600 px-4 py-2.5 font-medium text-coffee-50 disabled:opacity-50"
        >
          {busy ? 'Working…' : 'I saved it — continue'}
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-coffee-100">TakApp</h1>
        <p className="mt-1 text-coffee-300">Your coffee, on Stellar.</p>
      </div>
      {phase === 'welcome' && (
        <div className="flex flex-col gap-3">
          <button
            onClick={() => {
              setError(null);
              setPhase('signup');
            }}
            className="rounded-md bg-coffee-600 px-4 py-2.5 font-medium text-coffee-50"
          >
            Create a wallet
          </button>
          <button
            onClick={() => {
              setError(null);
              setPhase('login');
            }}
            className="rounded-md border border-coffee-700 px-4 py-2.5 font-medium text-coffee-200"
          >
            Log in
          </button>
        </div>
      )}
      {phase === 'signup' && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void runSignup(String(form.get('email')), String(form.get('password')));
          }}
        >
          <input
            name="email"
            type="email"
            required
            placeholder="Email"
            className="rounded-md border border-coffee-700 bg-coffee-900 px-3 py-2 text-coffee-100"
          />
          <input
            name="password"
            type="password"
            required
            minLength={8}
            placeholder="Password (min 8 characters)"
            className="rounded-md border border-coffee-700 bg-coffee-900 px-3 py-2 text-coffee-100"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-coffee-600 px-4 py-2.5 font-medium text-coffee-50 disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create wallet'}
          </button>
        </form>
      )}
      {phase === 'login' && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void runLogin(String(form.get('password')));
          }}
        >
          <input
            name="email"
            type="email"
            required
            placeholder="Email"
            className="rounded-md border border-coffee-700 bg-coffee-900 px-3 py-2 text-coffee-100"
          />
          <input
            name="password"
            type="password"
            required
            placeholder="Password"
            className="rounded-md border border-coffee-700 bg-coffee-900 px-3 py-2 text-coffee-100"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-coffee-600 px-4 py-2.5 font-medium text-coffee-50 disabled:opacity-50"
          >
            {busy ? 'Logging in…' : 'Log in'}
          </button>
        </form>
      )}
      {error && <p className="text-sm text-red-400">{error.message}</p>}
    </main>
  );
}
