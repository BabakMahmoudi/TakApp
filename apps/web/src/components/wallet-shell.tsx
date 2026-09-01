'use client';

import { useEffect, useRef, useState } from 'react';
import { isPositiveStroops, lumensFromStroops, stroopsFromLumens } from '@takapp/shared/money';
import { deriveEncryptionKey, encryptSecret, fromBase64, generateSalt, toBase64, decryptSecret } from '../lib/crypto';
import { generateMnemonicPhrase, isValidMnemonicPhrase } from '../lib/recovery';
import { clearAdminToken, clearSession, getSession, getWallet, saveSession, saveWallet } from '../lib/storage';
import { trpc } from '../lib/trpc/trpc';
import { createStellarWorkerClient, type StellarWorkerClient } from '../workers/stellar-worker-client';
import AdminPanel from './admin-panel';

type Phase = 'welcome' | 'signup' | 'mnemonic' | 'trustline' | 'login' | 'balance';
type ErrorMessage = { message: string } | null;
type PaymentAction = (secretKey: string) => Promise<void>;

const WAIT_RETRIES = 10;
const WAIT_DELAY_MS = 2000;
const ATTEMPT_TIMEOUT_MS = 25_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export default function WalletShell() {
  const [phase, setPhase] = useState<Phase>(() => (getSession() ? 'balance' : 'welcome'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorMessage>(null);

  const workerRef = useRef<StellarWorkerClient | null>(null);
  const flowRef = useRef<{ publicKey: string; secretKey: string; mnemonic: string } | null>(null);
  const credentialsRef = useRef<{ email: string; password: string } | null>(null);
  const trustlineSubmittedRef = useRef(false);
  const sessionSecretRef = useRef<string | null>(null);
  const pendingPaymentRef = useRef<PaymentAction | null>(null);

  const [passwordPromptOpen, setPasswordPromptOpen] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [recipient, setRecipient] = useState<{ publicKey: string; displayName: string | null } | null>(null);
  const [sendAmount, setSendAmount] = useState('');
  const [profileName, setProfileName] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);

  const signupMutation = trpc.auth.signup.useMutation();
  const challengeMutation = trpc.auth.challenge.useMutation();
  const loginMutation = trpc.auth.login.useMutation();
  const clientLogMutation = trpc.auth.clientLog.useMutation();
  const balanceQuery = trpc.wallet.balance.useQuery({}, {
    enabled: phase === 'balance',
    retry: false,
  });
  const networkConfigQuery = trpc.wallet.networkConfig.useQuery(undefined, {
    enabled: phase === 'trustline' || phase === 'balance',
    retry: false,
  });
  const shopsQuery = trpc.shops.list.useQuery(undefined, {
    enabled: phase === 'balance',
    retry: false,
  });
  const meQuery = trpc.users.me.useQuery(undefined, {
    enabled: phase === 'balance',
    retry: false,
  });
  const claimGiftMutation = trpc.wallet.claimGift.useMutation();
  const recordPaymentMutation = trpc.payments.record.useMutation();
  const updateProfileMutation = trpc.users.updateProfile.useMutation();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (meQuery.data) setProfileName(meQuery.data.displayName ?? '');
  }, [meQuery.data]);

  const searchResultsQuery = trpc.users.search.useQuery(
    { query: debouncedSearch },
    { enabled: debouncedSearch.length > 0, retry: false },
  );

  function beacon(message: string): void {
    void clientLogMutation.mutateAsync({ message }).catch(() => undefined);
  }

  function worker(): StellarWorkerClient {
    if (!workerRef.current) workerRef.current = createStellarWorkerClient();
    return workerRef.current;
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
        beacon('trustline: submitChangeTrust start');
        await submitChangeTrustWithRetry(flow.secretKey, config, worker());
        beacon('trustline: submitChangeTrust ok');
        await runLogin(credentialsRef.current?.password ?? '', flow.publicKey);
      } catch (cause) {
        beacon(`trustline: flow failed: ${cause instanceof Error ? cause.message : String(cause)}`);
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
      beacon(`trustline: attempt ${attempt + 1}/${WAIT_RETRIES}`);
      try {
        await withTimeout(
          client.submitChangeTrust({
            secretKey,
            assetCode: config.takAsset.code,
            assetIssuer: config.takAsset.issuer,
            horizonUrl: config.horizonUrl,
            networkPassphrase: config.networkPassphrase,
          }),
          ATTEMPT_TIMEOUT_MS,
        );
        return;
      } catch (cause) {
        lastError = cause;
        beacon(`trustline: attempt ${attempt + 1} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
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
      beacon(`login: start publicKey=${publicKey.slice(0, 6)}`);
      const challenge = await challengeMutation.mutateAsync({ publicKey });
      const key = await deriveEncryptionKey(password, fromBase64(wallet.salt));
      const secretKey = await decryptSecret(key, wallet.iv, wallet.encryptedSecret);
      sessionSecretRef.current = secretKey;
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
      beacon('login: ok');
      setPhase('balance');
    } catch (cause) {
      beacon(`login: failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      setError({ message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy(false);
    }
  }

  function logout(): void {
    clearSession();
    clearAdminToken();
    trustlineSubmittedRef.current = false;
    flowRef.current = null;
    sessionSecretRef.current = null;
    pendingPaymentRef.current = null;
    setPasswordPromptOpen(false);
    setPhase('welcome');
  }

  function startPayment(action: PaymentAction): void {
    if (sessionSecretRef.current) {
      setBusy(true);
      void (async () => {
        try {
          await action(sessionSecretRef.current as string);
        } catch (cause) {
          setError({ message: cause instanceof Error ? cause.message : String(cause) });
        } finally {
          setBusy(false);
        }
      })();
      return;
    }
    pendingPaymentRef.current = action;
    setPasswordError(null);
    setPasswordPromptOpen(true);
  }

  async function submitPaymentPassword(password: string): Promise<void> {
    setPasswordError(null);
    try {
      const wallet = await getWallet();
      if (!wallet) throw new Error('No wallet found on this device');
      const key = await deriveEncryptionKey(password, fromBase64(wallet.salt));
      const secretKey = await decryptSecret(key, wallet.iv, wallet.encryptedSecret);
      sessionSecretRef.current = secretKey;
      const action = pendingPaymentRef.current;
      pendingPaymentRef.current = null;
      setPasswordPromptOpen(false);
      setBusy(true);
      try {
        if (action) await action(secretKey);
      } catch (cause) {
        setError({ message: cause instanceof Error ? cause.message : String(cause) });
      } finally {
        setBusy(false);
      }
    } catch (cause) {
      setPasswordError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function cancelPaymentPassword(): void {
    pendingPaymentRef.current = null;
    setPasswordPromptOpen(false);
    setPasswordError(null);
  }

  async function doPayment(input: {
    secretKey: string;
    destination: string;
    amountLumens: string;
    stroops: string;
    coffeeShopId?: number;
    recipientPublicKey?: string;
  }): Promise<void> {
    const config = networkConfigQuery.data;
    if (!config) throw new Error('Network config not loaded');
    const txHash = await withTimeout(
      worker().submitPayment({
        secretKey: input.secretKey,
        destination: input.destination,
        assetCode: config.takAsset.code,
        assetIssuer: config.takAsset.issuer,
        amount: input.amountLumens,
        horizonUrl: config.horizonUrl,
        networkPassphrase: config.networkPassphrase,
      }),
      ATTEMPT_TIMEOUT_MS,
    );
    await recordPaymentMutation.mutateAsync({
      txHash,
      amount: input.stroops,
      asset: 'TAK',
      ...(input.coffeeShopId !== undefined
        ? { coffeeShopId: input.coffeeShopId }
        : { recipientPublicKey: input.recipientPublicKey }),
    });
    await balanceQuery.refetch();
  }

  async function buyCoffee(shop: { id: number; name: string; ownerPublicKey: string | null }): Promise<void> {
    setError(null);
    if (!shop.ownerPublicKey) {
      setError({ message: 'This shop has no payment account yet' });
      return;
    }
    startPayment(async (secretKey) => {
      await doPayment({
        secretKey,
        destination: shop.ownerPublicKey as string,
        amountLumens: '1',
        stroops: '10000000',
        coffeeShopId: shop.id,
      });
    });
  }

  async function sendTak(): Promise<void> {
    setError(null);
    if (!recipient) {
      setError({ message: 'Search and select a recipient first' });
      return;
    }
    const session = getSession();
    if (session && recipient.publicKey === session.publicKey) {
      setError({ message: 'Cannot send TAK to yourself' });
      return;
    }
    let stroops: string;
    try {
      const trimmed = sendAmount.trim();
      stroops = stroopsFromLumens(trimmed);
      if (!isPositiveStroops(stroops)) throw new Error('Amount must be greater than zero');
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : String(cause) });
      return;
    }
    startPayment(async (secretKey) => {
      await doPayment({
        secretKey,
        destination: recipient.publicKey,
        amountLumens: sendAmount.trim(),
        stroops,
        recipientPublicKey: recipient.publicKey,
      });
    });
  }

  async function claimGift(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await claimGiftMutation.mutateAsync();
      await balanceQuery.refetch();
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusy(false);
    }
  }

  async function copyPublicKey(): Promise<void> {
    const session = getSession();
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError({ message: 'Could not copy your address' });
    }
  }

  async function saveProfile(): Promise<void> {
    setError(null);
    try {
      const result = await updateProfileMutation.mutateAsync({ displayName: profileName.trim() });
      setProfileName(result.displayName);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2000);
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : String(cause) });
    }
  }

  if (phase === 'balance') {
    const session = getSession();
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-coffee-200">TakApp</h1>
          <button onClick={logout} className="rounded-md border border-coffee-700 px-3 py-1.5 text-sm">
            Log out
          </button>
        </header>

        <section className="rounded-xl bg-coffee-900 p-6 shadow">
          <h2 className="text-sm font-medium text-coffee-300">My address</h2>
          <code className="mt-2 block break-all font-mono text-xs text-coffee-100">{session?.publicKey}</code>
          <button
            onClick={() => void copyPublicKey()}
            className="mt-3 rounded-md border border-coffee-700 px-3 py-1.5 text-xs text-coffee-200"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </section>

        <section className="rounded-xl bg-coffee-900 p-6 shadow">
          <h2 className="text-sm font-medium text-coffee-300">Balances</h2>
          {balanceQuery.isLoading ? (
            <p className="mt-2 text-coffee-300">Loading balances…</p>
          ) : balanceQuery.isError ? (
            <p className="mt-2 text-red-400">{balanceQuery.error.message}</p>
          ) : (
            <ul className="mt-2 divide-y divide-coffee-800">
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

        <section className="rounded-xl bg-coffee-900 p-6 shadow">
          <h2 className="text-sm font-medium text-coffee-300">Free TAK</h2>
          <p className="mt-1 text-xs text-coffee-400">Claim a one-time welcome gift of 10 TAK.</p>
          <button
            onClick={() => void claimGift()}
            disabled={busy}
            className="mt-3 rounded-md bg-coffee-600 px-4 py-2 text-sm font-medium text-coffee-50 disabled:opacity-50"
          >
            {busy ? 'Claiming…' : 'Claim 10 free TAK'}
          </button>
        </section>

        <section className="rounded-xl bg-coffee-900 p-6 shadow">
          <h2 className="text-sm font-medium text-coffee-300">Buy coffee</h2>
          {shopsQuery.isLoading ? (
            <p className="mt-2 text-coffee-300">Loading shops…</p>
          ) : shopsQuery.isError ? (
            <p className="mt-2 text-red-400">{shopsQuery.error.message}</p>
          ) : (
            <ul className="mt-2 divide-y divide-coffee-800">
              {shopsQuery.data?.shops.map((shop) => (
                <li key={shop.id} className="flex items-center justify-between gap-2 py-3">
                  <div>
                    <p className="text-sm text-coffee-100">{shop.name}</p>
                    <p className="text-xs text-coffee-400">{shop.address ?? '—'}</p>
                  </div>
                  <button
                    onClick={() => void buyCoffee(shop)}
                    disabled={busy}
                    className="rounded-md bg-coffee-600 px-3 py-1.5 text-sm font-medium text-coffee-50 disabled:opacity-50"
                  >
                    Buy coffee (1 TAK)
                  </button>
                </li>
              ))}
              {(shopsQuery.data?.shops.length ?? 0) === 0 && (
                <li className="py-3 text-coffee-300">No shops available</li>
              )}
            </ul>
          )}
        </section>

        <section className="rounded-xl bg-coffee-900 p-6 shadow">
          <h2 className="text-sm font-medium text-coffee-300">Send TAK</h2>
          <input
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setRecipient(null);
            }}
            placeholder="Search a user by name or address"
            className="mt-3 rounded-md border border-coffee-700 bg-coffee-950 px-3 py-2 text-coffee-100"
          />
          {recipient && (
            <p className="mt-2 text-xs text-coffee-300">
              Sending to <span className="font-mono">{recipient.displayName ?? recipient.publicKey.slice(0, 12)}</span>
            </p>
          )}
          {!recipient && debouncedSearch.length > 0 && searchResultsQuery.data?.results.length === 0 && (
            <p className="mt-2 text-xs text-coffee-400">No users found</p>
          )}
          {!recipient && (
            <ul className="mt-2 divide-y divide-coffee-800">
              {searchResultsQuery.data?.results.map((result) => (
                <li key={result.publicKey}>
                  <button
                    onClick={() => setRecipient(result)}
                    className="flex w-full items-center justify-between gap-2 py-2 text-left"
                  >
                    <span className="text-sm text-coffee-100">{result.displayName ?? 'Unnamed user'}</span>
                    <span className="font-mono text-xs text-coffee-400">{result.publicKey.slice(0, 12)}…</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex gap-2">
            <input
              value={sendAmount}
              onChange={(event) => setSendAmount(event.target.value)}
              inputMode="decimal"
              placeholder="Amount in TAK"
              className="flex-1 rounded-md border border-coffee-700 bg-coffee-950 px-3 py-2 text-coffee-100"
            />
            <button
              onClick={() => void sendTak()}
              disabled={busy || !recipient || sendAmount.trim().length === 0}
              className="rounded-md bg-coffee-600 px-4 py-2 text-sm font-medium text-coffee-50 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </section>

        <section className="rounded-xl bg-coffee-900 p-6 shadow">
          <h2 className="text-sm font-medium text-coffee-300">Profile</h2>
          <div className="mt-3 flex gap-2">
            <input
              value={profileName}
              onChange={(event) => {
                setProfileName(event.target.value);
                setProfileSaved(false);
              }}
              maxLength={50}
              placeholder="Display name"
              className="flex-1 rounded-md border border-coffee-700 bg-coffee-950 px-3 py-2 text-coffee-100"
            />
            <button
              onClick={() => void saveProfile()}
              disabled={updateProfileMutation.isPending || profileName.trim().length === 0}
              className="rounded-md bg-coffee-600 px-4 py-2 text-sm font-medium text-coffee-50 disabled:opacity-50"
            >
              {profileSaved ? 'Saved' : 'Save'}
            </button>
          </div>
        </section>

        {passwordPromptOpen && (
          <form
            className="rounded-xl border border-coffee-700 bg-coffee-950 p-4 shadow"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void submitPaymentPassword(String(form.get('paymentPassword')));
            }}
          >
            <p className="text-sm text-coffee-200">Enter your password to sign this payment.</p>
            <div className="mt-2 flex gap-2">
              <input
                name="paymentPassword"
                type="password"
                required
                placeholder="Password"
                className="flex-1 rounded-md border border-coffee-700 bg-coffee-900 px-3 py-2 text-coffee-100"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-coffee-600 px-4 py-2 text-sm font-medium text-coffee-50 disabled:opacity-50"
              >
                Sign
              </button>
              <button
                type="button"
                onClick={cancelPaymentPassword}
                className="rounded-md border border-coffee-700 px-3 py-2 text-sm text-coffee-200"
              >
                Cancel
              </button>
            </div>
            {passwordError && <p className="mt-2 text-sm text-red-400">{passwordError}</p>}
          </form>
        )}

        {error && <p className="text-sm text-red-400">{error.message}</p>}
        <AdminPanel />
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
