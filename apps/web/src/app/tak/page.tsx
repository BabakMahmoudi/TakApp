'use client';

import Link from 'next/link';
import { lumensFromStroops } from '@takapp/shared/money';
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

  const claimed = status.data?.claimed === true;
  const claimError = claim.error ? t(takClaimErrorKey(typedCode(claim.error))) : null;

  const referencePriceRial = offersQuery.data?.referencePriceRial ?? null;
  const offers = offersQuery.data?.offers ?? [];

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
