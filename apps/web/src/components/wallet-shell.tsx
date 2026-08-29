'use client';

import { useEffect, useRef, useState } from 'react';
import { lumensFromStroops } from '@takapp/shared/money';
import { deriveEncryptionKey, encryptSecret, fromBase64, generateSalt, toBase64, decryptSecret } from '../lib/crypto';
import { generateMnemonicPhrase, isValidMnemonicPhrase } from '../lib/recovery';
import { clearSession, getSession, getWallet, saveSession, saveWallet } from '../lib/storage';
import { trpc } from '../lib/trpc/trpc';
import { createStellarWorkerClient, type StellarWorkerClient } from '../workers/stellar-worker-client';

type Phase = 'welcome' | 'signup' | 'mnemonic' | 'trustline' | 'login' | 'balance';
type ErrorMessage = { message: string } | null;

const WAIT_RETRIES = 10;
const WAIT_DELAY_MS = 2000;

export default function WalletShell() {
  const [phase, setPhase] = useState<Phase>(() => (getSession() ? 'balance' : 'welcome'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorMessage>(null);

  const workerRef = useRef<StellarWorkerClient | null>(null);
  const flowRef = useRef<{ publicKey: string; secretKey: string; mnemonic: string } | null>(null);
  const credentialsRef = useRef<{ email: string; password: string } | null>(null);
  const trustlineSubmittedRef = useRef(false);

  const signupMutation = trpc.auth.signup.useMutation();
  const challengeMutation = trpc.auth.challenge.useMutation();
  const loginMutation = trpc.auth.login.useMutation();
  const balanceQuery = trpc.wallet.balance.useQuery({}, {
    enabled: phase === 'balance',
    retry: false,
  });
  const networkConfigQuery = trpc.wallet.networkConfig.useQuery(undefined, {
    enabled: phase === 'trustline',
    retry: false,
  });

  function worker(): StellarWorkerClient {
    if (!workerRef.current) workerRef.current = createStellarWorkerClient();
    return workerRef.current;
  }

  async function runSignup(email: string, password: string): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const { publicKey, secretKey } = await worker().generateKeypair();
      const mnemonic = generateMnemonicPhrase();
      if (!isValidMnemonicPhrase(mnemonic)) throw new Error('Failed to generate a valid mnemonic');
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
      setPhase('trustline');
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (phase !== 'trustline' || trustlineSubmittedRef.current) return;
    const config = networkConfigQuery.data;
    const flow = flowRef.current;
    if (!config || !flow) return;
    trustlineSubmittedRef.current = true;
    void (async () => {
      try {
        await submitChangeTrustWithRetry(flow.secretKey, config, worker());
        await runLogin(credentialsRef.current?.password ?? '', flow.publicKey);
      } catch (cause) {
        setError({ message: cause instanceof Error ? cause.message : String(cause) });
        setPhase('login');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, networkConfigQuery.data]);

  async function submitChangeTrustWithRetry(
    secretKey: string,
    config: { horizonUrl: string; networkPassphrase: string; takAsset: { code: string; issuer: string } },
    client: StellarWorkerClient,
  ): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < WAIT_RETRIES; attempt++) {
      try {
        await client.submitChangeTrust({
          secretKey,
          assetCode: config.takAsset.code,
          assetIssuer: config.takAsset.issuer,
          horizonUrl: config.horizonUrl,
          networkPassphrase: config.networkPassphrase,
        });
        return;
      } catch (cause) {
        lastError = cause;
        await new Promise((resolve) => setTimeout(resolve, WAIT_DELAY_MS));
      }
    }
    throw lastError ?? new Error('Timed out establishing the TAK trustline');
  }

  async function runLogin(password: string, publicKeyOverride?: string): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const wallet = await getWallet();
      if (!wallet) throw new Error('No wallet found on this device');
      const publicKey = publicKeyOverride ?? wallet.publicKey;
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
      saveSession({ token: result.token, publicKey });
      setPhase('balance');
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy(false);
    }
  }

  function logout(): void {
    clearSession();
    trustlineSubmittedRef.current = false;
    flowRef.current = null;
    setPhase('welcome');
  }

  if (phase === 'balance') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-coffee-200">TakApp</h1>
          <button onClick={logout} className="rounded-md border border-coffee-700 px-3 py-1.5 text-sm">
            Log out
          </button>
        </header>
        <section className="rounded-xl bg-coffee-900 p-6 shadow">
          {balanceQuery.isLoading ? (
            <p className="text-coffee-300">Loading balances…</p>
          ) : balanceQuery.isError ? (
            <p className="text-red-400">{balanceQuery.error.message}</p>
          ) : (
            <ul className="divide-y divide-coffee-800">
              {balanceQuery.data?.balances.map((entry) => (
                <li key={entry.asset} className="flex items-center justify-between py-3">
                  <span className="text-coffee-300">{entry.asset}</span>
                  <span className="font-mono text-lg text-coffee-100">{lumensFromStroops(entry.stroops)}</span>
                </li>
              ))}
              {balanceQuery.data?.balances.length === 0 && (
                <li className="py-3 text-coffee-300">No balances yet</li>
              )}
            </ul>
          )}
        </section>
      </main>
    );
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

  if (phase === 'trustline') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="text-xl font-semibold text-coffee-200">Activating your wallet</h1>
        <p className="text-sm text-coffee-300">
          Funding your account and establishing the TAK trustline on testnet…
        </p>
        {error && <p className="text-sm text-red-400">{error.message}</p>}
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
