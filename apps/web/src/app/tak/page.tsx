'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { isPositiveStroops, lumensFromStroops, stroopsFromLumens } from '@takapp/shared/money';
import type { Messages } from '../../lib/i18n/messages';
import type { Locale } from '../../lib/i18n';
import { formatAmount, useI18n } from '../../lib/i18n';
import { trpc } from '../../lib/trpc/trpc';
import { useWallet } from '../../lib/wallet-provider';

function takClaimErrorKey(typedCode: string | undefined): keyof Messages {
  switch (typedCode) {
    case 'ALREADY_CLAIMED':
      return 'tak.claim.errors.alreadyClaimed';
    case 'FAUCET_NOT_READY':
      return 'tak.claim.errors.notReady';
    case 'FAUCET_OUT_OF_FUNDS':
      return 'tak.claim.errors.outOfFunds';
    case 'CLAIM_FAILED':
      return 'tak.claim.errors.claimFailed';
    default:
      return 'errors.generic';
  }
}

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

function truncatedKey(publicKey: string): string {
  return publicKey.length > 12 ? `${publicKey.slice(0, 12)}…` : publicKey;
}

export default function TakPage() {
  const { session, refetchBalances } = useWallet();
  const { t, locale } = useI18n();
  const utils = trpc.useUtils();
  const status = trpc.tak.status.useQuery(undefined, { retry: false });
  const claim = trpc.tak.claim.useMutation();
  const offersQuery = trpc.offers.list.useQuery(undefined, { enabled: !!session, retry: false });
  const upsert = trpc.offers.upsert.useMutation();
  const renew = trpc.offers.renew.useMutation();
  const deleteOffer = trpc.offers.delete.useMutation();

  const [showForm, setShowForm] = useState(false);
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

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

  function handleClaim() {
    claim.mutate(undefined, {
      onSuccess: () => {
        void refetchBalances();
        void utils.tak.status.invalidate();
      },
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

  const claimed = status.data?.claimed === true;
  const claimError = claim.error ? t(takClaimErrorKey(typedCode(claim.error))) : null;

  const referencePriceRial = offersQuery.data?.referencePriceRial ?? null;
  const mine = offersQuery.data?.mine ?? null;
  const offers = offersQuery.data?.offers ?? [];
  const offerActionError =
    upsert.error || renew.error || deleteOffer.error
      ? t(offerErrorKey(typedCode(upsert.error ?? renew.error ?? deleteOffer.error)))
      : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold text-coffee-100">{t('tak.title')}</h1>

      <div className="rounded-xl bg-coffee-900 p-6 shadow">
        {claimed ? (
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-coffee-300">{t('tak.claimed')}</h2>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={handleClaim}
              disabled={claim.isPending}
              className="rounded-md bg-coffee-600 px-4 py-3 font-medium text-coffee-50 disabled:opacity-50"
            >
              {claim.isPending ? t('tak.claiming') : t('tak.claimButton')}
            </button>
            {claimError && <p className="text-sm text-red-400">{claimError}</p>}
          </div>
        )}
      </div>

      <section className="rounded-xl bg-coffee-900 p-6 shadow">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-coffee-300">{t('tak.price.title')}</h2>
        </div>
        <p className="mt-2 text-2xl font-semibold text-coffee-100">
          {referencePriceRial === null
            ? t('tak.price.noOffers')
            : `${formatRial(locale, referencePriceRial)} ${t('tak.offer.rialPerTak')}`}
        </p>
      </section>

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

      <section className="rounded-xl bg-coffee-900 p-6 shadow">
        <h2 className="text-sm font-medium text-coffee-300">{t('tak.offer.title')}</h2>
        {offers.length === 0 ? (
          <p className="mt-3 text-sm text-coffee-400">{t('tak.price.noOffers')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-coffee-800">
            {offers.map((offer) => (
              <li key={offer.id} className="py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-coffee-100">
                    {offer.sellerDisplayName ?? truncatedKey(offer.sellerPublicKey)}
                    {offer.isMine && <span className="text-xs text-coffee-400"> ({t('tak.offer.yourOffer')})</span>}
                  </span>
                  <span className="text-sm font-medium text-coffee-100">
                    {formatRial(locale, offer.priceRial)} {t('tak.offer.rialPerTak')}
                  </span>
                </div>
                <p className="mt-1 text-sm text-coffee-300">
                  {offer.amountStroops
                    ? `${formatAmount(locale, lumensFromStroops(offer.amountStroops))} TAK`
                    : t('tak.offer.unlimited')}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-xs text-coffee-400">{offer.memo}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
