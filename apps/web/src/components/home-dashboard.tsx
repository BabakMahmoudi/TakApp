'use client';

import { useState } from 'react';
import Link from 'next/link';
import { lumensFromStroops } from '@takapp/shared/money';
import { formatAmount, useI18n } from '../lib/i18n';
import { useWallet } from '../lib/wallet-provider';
import BuyCoffeeButton from './buy-coffee-button';

export default function HomeDashboard() {
  const { session, balanceQuery, error, setError } = useWallet();
  const { locale, t } = useI18n();

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

  const takBalance = balanceQuery.data?.balances.find((entry) => entry.asset === 'TAK');

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
      <section className="rounded-xl bg-coffee-900 p-6 shadow">
        <h2 className="text-sm font-medium text-coffee-300">{t('home.takBalance')}</h2>
        <p className="mt-2 flex items-baseline gap-2">
          <span className="text-5xl font-bold text-coffee-100">
            {balanceQuery.isLoading
              ? '…'
              : balanceQuery.isError
                ? '—'
                : formatAmount(locale, lumensFromStroops(takBalance ? takBalance.stroops : '0'))}
          </span>
          <span className="text-lg font-semibold text-coffee-300">TAK</span>
        </p>
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
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/send"
            className="rounded-xl bg-coffee-900 p-6 shadow text-center text-lg font-semibold text-coffee-100"
          >
            {t('home.send')}
          </Link>
          <Link
            href="/tak"
            className="rounded-xl bg-coffee-900 p-6 shadow text-center text-lg font-semibold text-coffee-100"
          >
            {t('home.get')}
          </Link>
        </div>
      </section>

      {error && <p className="text-sm text-red-400">{error.message}</p>}
    </main>
  );
}
