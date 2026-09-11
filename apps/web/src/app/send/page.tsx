'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { isPositiveStroops, lumensFromStroops, stroopsFromLumens } from '@takapp/shared/money';
import { formatAmount, useI18n } from '../../lib/i18n';
import type { Locale } from '../../lib/i18n';
import type { Messages } from '../../lib/i18n/messages';
import { trpc } from '../../lib/trpc/trpc';
import { useWallet } from '../../lib/wallet-provider';

function offerErrorKey(typedCode: string | undefined): keyof Messages {
  switch (typedCode) {
    case 'OFFER_NOT_FOUND':
      return 'tak.offer.errors.offerNotFound';
    default:
      return 'errors.generic';
  }
}

function typedCode(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

function formatRial(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
    maximumFractionDigits: 0,
  }).format(value);
}

export default function SendPage() {
  const { session, busy, error, setError, signPayment, submitPayment } = useWallet();
  const { t, locale } = useI18n();
  const utils = trpc.useUtils();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [recipient, setRecipient] = useState<{ publicKey: string; displayName: string | null } | null>(null);
  const [sendAmount, setSendAmount] = useState('');

  const offersQuery = trpc.offers.list.useQuery(undefined, { enabled: !!session, retry: false });
  const upsert = trpc.offers.upsert.useMutation();
  const renew = trpc.offers.renew.useMutation();
  const deleteOffer = trpc.offers.delete.useMutation();

  const [showForm, setShowForm] = useState(false);
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

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

  function openForm() {
    const mine = offersQuery.data?.mine ?? null;
    setPrice(mine ? String(mine.priceRial) : '');
    setAmount(mine && mine.amountStroops ? lumensFromStroops(mine.amountStroops) : '');
    setMemo(mine?.memo ?? '');
    setFormError(null);
    setShowForm(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const priceRial = Number(price.trim());
    if (!Number.isInteger(priceRial) || priceRial <= 0 || priceRial > 1_000_000_000) {
      setFormError(t('tak.offer.errors.invalidPrice'));
      return;
    }

    let amountStroops: string | undefined;
    const trimmedAmount = amount.trim();
    if (trimmedAmount.length > 0) {
      try {
        amountStroops = stroopsFromLumens(trimmedAmount);
        if (!isPositiveStroops(amountStroops)) throw new Error();
      } catch {
        setFormError(t('tak.offer.errors.invalidAmount'));
        return;
      }
    }

    const trimmedMemo = memo.trim();
    if (trimmedMemo.length === 0) {
      setFormError(t('tak.offer.errors.invalidMemo'));
      return;
    }

    upsert.mutate(
      { priceRial, memo: trimmedMemo, ...(amountStroops !== undefined ? { amountStroops } : {}) },
      {
        onSuccess: () => {
          void utils.offers.list.invalidate();
          setShowForm(false);
        },
      },
    );
  }

  function handleRenew() {
    renew.mutate(undefined, {
      onSuccess: () => {
        void utils.offers.list.invalidate();
      },
    });
  }

  function handleDelete() {
    deleteOffer.mutate(undefined, {
      onSuccess: () => {
        void utils.offers.list.invalidate();
      },
    });
  }

  const mine = offersQuery.data?.mine ?? null;
  const offerActionError =
    upsert.error || renew.error || deleteOffer.error
      ? t(offerErrorKey(typedCode(upsert.error ?? renew.error ?? deleteOffer.error)))
      : null;

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

      <section className="rounded-xl bg-coffee-900 p-6 shadow">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-coffee-300">{t('tak.offer.title')}</h2>
          <button
            type="button"
            onClick={() => (showForm ? setShowForm(false) : openForm())}
            className="rounded-md border border-coffee-700 px-3 py-1.5 text-sm text-coffee-200"
          >
            {showForm ? t('admin.cancel') : mine ? t('tak.offer.update') : t('tak.offer.create')}
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-coffee-300">{t('tak.offer.priceLabel')}</span>
              <input
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                inputMode="numeric"
                className="rounded-md border border-coffee-700 bg-coffee-950 px-3 py-2 text-coffee-100"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-coffee-300">
                {t('tak.offer.amountLabel')} · {t('tak.offer.amountOptional')}
              </span>
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                className="rounded-md border border-coffee-700 bg-coffee-950 px-3 py-2 text-coffee-100"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-coffee-300">{t('tak.offer.memoLabel')}</span>
              <textarea
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                rows={3}
                className="rounded-md border border-coffee-700 bg-coffee-950 px-3 py-2 text-coffee-100"
              />
            </label>
            {formError && <p className="text-sm text-red-400">{formError}</p>}
            <button
              type="submit"
              disabled={upsert.isPending}
              className="rounded-md bg-coffee-600 px-4 py-2.5 font-medium text-coffee-50 disabled:opacity-50"
            >
              {mine ? t('tak.offer.update') : t('tak.offer.create')}
            </button>
          </form>
        )}

        {mine && !showForm && (
          <div className="mt-4 rounded-lg border border-coffee-800 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-coffee-100">{t('tak.offer.yourOffer')}</h3>
              {!mine.active && <span className="text-xs text-red-400">{t('tak.offer.expired')}</span>}
            </div>
            <p className="mt-2 text-sm text-coffee-200">
              {formatRial(locale, mine.priceRial)} {t('tak.offer.rialPerTak')}
            </p>
            <p className="mt-1 text-sm text-coffee-300">
              {mine.amountStroops ? `${formatAmount(locale, lumensFromStroops(mine.amountStroops))} TAK` : t('tak.offer.unlimited')}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-coffee-300">{mine.memo}</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={handleRenew}
                disabled={renew.isPending}
                className="rounded-md bg-coffee-600 px-3 py-1.5 text-sm font-medium text-coffee-50 disabled:opacity-50"
              >
                {t('tak.offer.renew')}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteOffer.isPending}
                className="rounded-md border border-coffee-700 px-3 py-1.5 text-sm text-coffee-200"
              >
                {t('tak.offer.delete')}
              </button>
            </div>
          </div>
        )}

        {offerActionError && <p className="mt-3 text-sm text-red-400">{offerActionError}</p>}
      </section>
    </main>
  );
}
