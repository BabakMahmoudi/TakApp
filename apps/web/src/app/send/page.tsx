'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { isPositiveStroops, stroopsFromLumens } from '@takapp/shared/money';
import { useI18n } from '../../lib/i18n';
import { trpc } from '../../lib/trpc/trpc';
import { useWallet } from '../../lib/wallet-provider';

export default function SendPage() {
  const { session, busy, error, setError, signPayment, submitPayment } = useWallet();
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [recipient, setRecipient] = useState<{ publicKey: string; displayName: string | null } | null>(null);
  const [sendAmount, setSendAmount] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const searchResultsQuery = trpc.users.search.useQuery(
    { query: debouncedSearch },
    { enabled: !!session && debouncedSearch.length > 0, retry: false },
  );

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

  async function sendTak(): Promise<void> {
    setError(null);
    if (!recipient) {
      setError({ message: t('send.error.selectRecipient') });
      return;
    }
    if (session && recipient.publicKey === session.publicKey) {
      setError({ message: t('send.error.selfSend') });
      return;
    }
    let stroops: string;
    try {
      const trimmed = sendAmount.trim();
      stroops = stroopsFromLumens(trimmed);
      if (!isPositiveStroops(stroops)) throw new Error(t('send.error.amountPositive'));
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : String(cause) });
      return;
    }
    signPayment(async (secretKey) => {
      await submitPayment({
        secretKey,
        destination: recipient.publicKey,
        stroops,
        recipientPublicKey: recipient.publicKey,
      });
    });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
      <section className="rounded-xl bg-coffee-900 p-6 shadow">
        <h2 className="text-sm font-medium text-coffee-300">{t('send.title')}</h2>
        <input
          value={searchQuery}
          onChange={(event) => {
            setSearchQuery(event.target.value);
            setRecipient(null);
          }}
          placeholder={t('send.searchPlaceholder')}
          className="mt-3 rounded-md border border-coffee-700 bg-coffee-950 px-3 py-2 text-coffee-100"
        />
        {recipient && (
          <p className="mt-2 text-xs text-coffee-300">
            {t('send.sendingTo')} <span className="font-mono">{recipient.displayName ?? recipient.publicKey.slice(0, 12)}</span>
          </p>
        )}
        {!recipient && debouncedSearch.length > 0 && searchResultsQuery.data?.results.length === 0 && (
          <p className="mt-2 text-xs text-coffee-400">{t('send.noUsersFound')}</p>
        )}
        {!recipient && (
          <ul className="mt-2 divide-y divide-coffee-800">
            {searchResultsQuery.data?.results.map((result) => (
              <li key={result.publicKey}>
                <button
                  onClick={() => setRecipient(result)}
                  className="flex w-full items-center justify-between gap-2 py-2 text-start"
                >
                  <span className="text-sm text-coffee-100">{result.displayName ?? t('send.unnamedUser')}</span>
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
            placeholder={t('send.amountPlaceholder')}
            className="flex-1 rounded-md border border-coffee-700 bg-coffee-950 px-3 py-2 text-coffee-100"
          />
          <button
            onClick={() => void sendTak()}
            disabled={busy || !recipient || sendAmount.trim().length === 0}
            className="rounded-md bg-coffee-600 px-4 py-2 text-sm font-medium text-coffee-50 disabled:opacity-50"
          >
            {t('send.send')}
          </button>
        </div>
      </section>
      {error && <p className="text-sm text-red-400">{error.message}</p>}
    </main>
  );
}
