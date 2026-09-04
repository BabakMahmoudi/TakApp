'use client';

import Link from 'next/link';
import { lumensFromStroops } from '@takapp/shared/money';
import { formatAmount, useI18n } from '../../lib/i18n';
import { useWallet } from '../../lib/wallet-provider';

export default function WalletPage() {
  const { session, balanceQuery } = useWallet();
  const { locale, t } = useI18n();

  if (!session) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
        <p className="text-coffee-300">{t('common.pleaseLogIn')}</p>
        <Link href="/" className="rounded-md bg-coffee-600 px-4 py-2.5 text-center font-medium text-coffee-50">
          {t('common.goToLogin')}
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold text-coffee-100">{t('wallet.title')}</h1>

      <section className="rounded-xl bg-coffee-900 p-6 shadow">
        <h2 className="text-sm font-medium text-coffee-300">{t('wallet.balances')}</h2>
        {balanceQuery.isLoading ? (
          <p className="mt-2 text-coffee-300">{t('wallet.loading')}</p>
        ) : balanceQuery.isError ? (
          <p className="mt-2 text-red-400">{balanceQuery.error.message}</p>
        ) : (
          <ul className="mt-2 divide-y divide-coffee-800">
            {balanceQuery.data?.balances.map((entry) => (
              <li key={entry.asset} className="flex items-center justify-between py-3">
                <span className="text-coffee-300">{entry.asset}</span>
                <span className="font-mono text-lg text-coffee-100">{formatAmount(locale, lumensFromStroops(entry.stroops))}</span>
              </li>
            ))}
            {balanceQuery.data?.balances.length === 0 && (
              <li className="py-3 text-coffee-300">{t('wallet.noBalances')}</li>
            )}
          </ul>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3">
        <Link
          href="/tak"
          className="rounded-xl bg-coffee-900 p-6 shadow text-center text-lg font-semibold text-coffee-100"
        >
          {t('wallet.getTak')}
        </Link>
        <Link
          href="/send"
          className="rounded-xl bg-coffee-900 p-6 shadow text-center text-lg font-semibold text-coffee-100"
        >
          {t('wallet.send')}
        </Link>
      </section>
    </main>
  );
}
