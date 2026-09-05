'use client';

import Link from 'next/link';
import type { Messages } from '../../lib/i18n/messages';
import { useI18n } from '../../lib/i18n';
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
  // The server encodes the TakFaucetError typed code in `error.message` (see
  // `toTrpcTakError`); `takClaimErrorKey` maps it to an i18n key.
  return error instanceof Error ? error.message : undefined;
}

export default function TakPage() {
  const { session, refetchBalances } = useWallet();
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const status = trpc.tak.status.useQuery(undefined, { retry: false });
  const claim = trpc.tak.claim.useMutation();

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
    </main>
  );
}
