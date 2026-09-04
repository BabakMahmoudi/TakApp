'use client';

import type { TRPCClientErrorLike } from '@trpc/client';
import type { UseTRPCQueryResult } from '@trpc/react-query/shared';
import type { inferRouterOutputs } from '@trpc/server';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { AppRouter } from '../server/trpc/router';
import { createStellarWorkerClient } from '../workers/stellar-worker-client';
import type { StellarWorkerClient } from '../workers/stellar-worker-client';
import { decryptSecret, deriveEncryptionKey, fromBase64 } from './crypto';
import { useI18n } from './i18n';
import { clearAdminToken, clearSession, getSession, getWallet, saveSession } from './storage';
import type { SessionRecord } from './storage';
import { trpc } from './trpc/trpc';

export const ATTEMPT_TIMEOUT_MS = 25_000;

export type ErrorMessage = { message: string } | null;
type PaymentAction = (secretKey: string) => Promise<void>;

type BalanceData = inferRouterOutputs<AppRouter>['wallet']['balance'];
type NetworkConfigData = inferRouterOutputs<AppRouter>['wallet']['networkConfig'];
type AdminStatusData = inferRouterOutputs<AppRouter>['admin']['status'];
type ApiError = TRPCClientErrorLike<AppRouter>;

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
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

export function useStellarWorker(): () => StellarWorkerClient {
  const workerRef = useRef<StellarWorkerClient | null>(null);
  return () => {
    if (!workerRef.current) workerRef.current = createStellarWorkerClient();
    return workerRef.current;
  };
}

export interface PaymentInput {
  secretKey: string;
  destination: string;
  stroops: string;
  coffeeShopId?: number;
  menuItemId?: number;
  recipientPublicKey?: string;
}

interface WalletContextValue {
  session: SessionRecord | null;
  busy: boolean;
  error: ErrorMessage;
  setBusy: (busy: boolean) => void;
  setError: (error: ErrorMessage) => void;
  passwordPromptOpen: boolean;
  passwordError: string | null;
  balanceQuery: UseTRPCQueryResult<BalanceData, ApiError>;
  networkConfigQuery: UseTRPCQueryResult<NetworkConfigData, ApiError>;
  adminStatusQuery: UseTRPCQueryResult<AdminStatusData, ApiError>;
  isAdmin: boolean;
  refetchBalances: () => Promise<void>;
  completeLogin: (token: string, publicKey: string, secretKey: string) => void;
  logout: () => void;
  signPayment: (action: PaymentAction) => void;
  submitPayment: (input: PaymentInput) => Promise<void>;
  submitPaymentPassword: (password: string) => Promise<void>;
  cancelPaymentPassword: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error('useWallet must be used within a WalletProvider');
  return value;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [session, setSession] = useState<SessionRecord | null>(() => getSession());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorMessage>(null);
  const [passwordPromptOpen, setPasswordPromptOpen] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const secretKeyRef = useRef<string | null>(null);
  const pendingPaymentRef = useRef<PaymentAction | null>(null);
  const worker = useStellarWorker();

  const balanceQuery = trpc.wallet.balance.useQuery({}, {
    enabled: !!session,
    retry: false,
  });
  const networkConfigQuery = trpc.wallet.networkConfig.useQuery(undefined, {
    enabled: !!session,
    retry: false,
  });
  const adminStatusQuery = trpc.admin.status.useQuery(undefined, {
    enabled: !!session,
    retry: false,
  });
  const recordPaymentMutation = trpc.payments.record.useMutation();

  useEffect(() => {
    if (adminStatusQuery.error) console.warn('[admin.status]', adminStatusQuery.error);
  }, [adminStatusQuery.error]);

  function completeLogin(token: string, publicKey: string, secretKey: string): void {
    saveSession({ token, publicKey });
    secretKeyRef.current = secretKey;
    setSession({ token, publicKey });
  }

  function logout(): void {
    clearSession();
    clearAdminToken();
    secretKeyRef.current = null;
    pendingPaymentRef.current = null;
    setPasswordPromptOpen(false);
    setPasswordError(null);
    setError(null);
    setSession(null);
  }

  function signPayment(action: PaymentAction): void {
    if (secretKeyRef.current) {
      setBusy(true);
      void (async () => {
        try {
          await action(secretKeyRef.current as string);
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
      if (!wallet) throw new Error(t('auth.error.noWallet'));
      const key = await deriveEncryptionKey(password, fromBase64(wallet.salt));
      const secretKey = await decryptSecret(key, wallet.iv, wallet.encryptedSecret);
      secretKeyRef.current = secretKey;
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

  async function submitPayment(input: PaymentInput): Promise<void> {
    const config = networkConfigQuery.data;
    if (!config) throw new Error('Network config not loaded');
    const txHash = await withTimeout(
      worker().submitPayment({
        secretKey: input.secretKey,
        destination: input.destination,
        contractId: config.takToken.contractId,
        amountRaw: input.stroops,
        rpcUrl: config.sorobanRpcUrl,
        horizonUrl: config.horizonUrl,
        networkPassphrase: config.networkPassphrase,
      }),
      ATTEMPT_TIMEOUT_MS,
    );
    await recordPaymentMutation.mutateAsync({
      txHash,
      amount: input.stroops,
      asset: 'TAK',
      ...(input.menuItemId !== undefined ? { menuItemId: input.menuItemId } : {}),
      ...(input.coffeeShopId !== undefined
        ? { coffeeShopId: input.coffeeShopId }
        : { recipientPublicKey: input.recipientPublicKey }),
    });
    await balanceQuery.refetch();
  }

  async function refetchBalances(): Promise<void> {
    await balanceQuery.refetch();
  }

  const value: WalletContextValue = {
    session,
    busy,
    error,
    setBusy,
    setError,
    passwordPromptOpen,
    passwordError,
    balanceQuery,
    networkConfigQuery,
    adminStatusQuery,
    isAdmin: adminStatusQuery.data?.isAdmin === true,
    refetchBalances,
    completeLogin,
    logout,
    signPayment,
    submitPayment,
    submitPaymentPassword,
    cancelPaymentPassword,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
      {passwordPromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            className="w-full max-w-sm rounded-xl border border-coffee-700 bg-coffee-950 p-4 shadow"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void submitPaymentPassword(String(form.get('paymentPassword')));
            }}
          >
            <p className="text-sm text-coffee-200">{t('payment.enterPassword')}</p>
            <div className="mt-2 flex gap-2">
              <input
                name="paymentPassword"
                type="password"
                required
                placeholder={t('payment.password')}
                className="flex-1 rounded-md border border-coffee-700 bg-coffee-900 px-3 py-2 text-coffee-100"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-coffee-600 px-4 py-2 text-sm font-medium text-coffee-50 disabled:opacity-50"
              >
                {t('payment.sign')}
              </button>
              <button
                type="button"
                onClick={cancelPaymentPassword}
                className="rounded-md border border-coffee-700 px-3 py-2 text-sm text-coffee-200"
              >
                {t('payment.cancel')}
              </button>
            </div>
            {passwordError && <p className="mt-2 text-sm text-red-400">{passwordError}</p>}
          </form>
        </div>
      )}
    </WalletContext.Provider>
  );
}
