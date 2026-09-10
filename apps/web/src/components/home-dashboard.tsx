'use client';

import { useState } from 'react';
import Link from 'next/link';
import { lumensFromStroops } from '@takapp/shared/money';
import { formatAmountLatin, useI18n } from '../lib/i18n';
import { trpc } from '../lib/trpc/trpc';
import { useWallet } from '../lib/wallet-provider';
import BuyCoffeeButton from './buy-coffee-button';
import TakSymbol from './tak-symbol';

export default function HomeDashboard() {
  const { session, error, setError } = useWallet();
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const meQuery = trpc.users.me.useQuery(undefined, { enabled: !!session, retry: false });
  const takBalanceQuery = trpc.wallet.takBalance.useQuery(undefined, {
    enabled: !!session,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const refreshTakBalance = trpc.wallet.refreshTakBalance.useMutation({
    onSuccess: (data) => {
      utils.wallet.takBalance.setData(undefined, { ...data, source: 'network' });
    },
  });

  const [copied, setCopied] = useState(false);

  async function copyPublicKey(): Promise<void> {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError({ message: t('home.error.copyFailed') });
    }
  }

  const takStroops = takBalanceQuery.data?.takStroops ?? '0';
  const refreshing = refreshTakBalance.isPending;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
      <section className="rounded-xl bg-coffee-900 p-6 shadow">
        <h2 className="text-sm font-medium text-coffee-300">
          {meQuery.data?.displayName ?? session?.publicKey.slice(0, 12) ?? '—'}
        </h2>
        <div className="mt-2 flex items-center gap-2" dir="ltr">
          <p className="flex items-center gap-2" dir="ltr">
            <span className="text-5xl font-bold text-coffee-100">
              {takBalanceQuery.isLoading
                ? '…'
                : takBalanceQuery.isError
                  ? '—'
                  : formatAmountLatin(lumensFromStroops(takStroops))}
            </span>
            <TakSymbol className="h-14 w-14" />
          </p>
          <button
            type="button"
            onClick={() => refreshTakBalance.mutate()}
            disabled={refreshing}
            aria-label={t('home.refresh')}
            title={t('home.refresh')}
            className="ml-auto rounded-md border border-coffee-700 px-3 py-1.5 text-xs text-coffee-200 disabled:opacity-50"
          >
            {refreshing ? '…' : t('home.refresh')}
          </button>
        </div>
        <h2 className="mt-6 text-sm font-medium text-coffee-300">{t('home.address')}</h2>
        <code className="mt-2 block break-all font-mono text-xs text-coffee-100">{session?.publicKey}</code>
        <button
          onClick={() => void copyPublicKey()}
          className="mt-3 rounded-md border border-coffee-700 px-3 py-1.5 text-xs text-coffee-200"
        >
          {copied ? t('home.copied') : t('home.copy')}
        </button>
      </section>

      <section className="flex flex-col gap-3">
        <BuyCoffeeButton />
        <Link
          href="/games"
          className="rounded-xl bg-coffee-900 p-6 shadow text-center text-lg font-semibold text-coffee-100"
        >
          {t('home.playToWin')}
        </Link>
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/send"
            className="flex items-center justify-center gap-2 rounded-xl bg-coffee-900 p-6 shadow text-center text-lg font-semibold text-coffee-100"
          >
            <TakSymbol className="h-6 w-6" />
            {t('home.send')}
          </Link>
          <Link
            href="/tak"
            className="flex items-center justify-center gap-2 rounded-xl bg-coffee-900 p-6 shadow text-center text-lg font-semibold text-coffee-100"
          >
            <TakSymbol className="h-6 w-6" />
            {t('home.get')}
          </Link>
        </div>
      </section>

      {error && <p className="text-sm text-red-400">{error.message}</p>}
    </main>
  );
}
