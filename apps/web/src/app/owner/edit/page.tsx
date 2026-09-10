'use client';

import Link from 'next/link';
import OwnerShopEditor from '../../../components/owner-shop-editor';
import { useI18n } from '../../../lib/i18n';
import { trpc } from '../../../lib/trpc/trpc';
import { useWallet } from '../../../lib/wallet-provider';

export default function OwnerEditPage() {
  const { session } = useWallet();
  const { t } = useI18n();
  const mineQuery = trpc.owner.mine.useQuery(undefined, { enabled: !!session, retry: false });

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
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-coffee-100">{t('owner.editTitle')}</h1>
        <Link href="/owner" className="rounded-md bg-coffee-600 px-3 py-1.5 text-sm font-medium text-coffee-50">
          {t('owner.back')}
        </Link>
      </div>

      {mineQuery.isLoading ? (
        <p className="text-sm text-coffee-300">{t('owner.loading')}</p>
      ) : mineQuery.isError ? (
        <p className="text-sm text-red-400">{mineQuery.error.message}</p>
      ) : !mineQuery.data || mineQuery.data.shops.length === 0 ? (
        <p className="text-sm text-coffee-300">{t('owner.noShops')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {mineQuery.data.shops.map((shop) => (
            <OwnerShopEditor key={shop.id} shop={shop} onChanged={() => void mineQuery.refetch()} />
          ))}
        </div>
      )}
    </main>
  );
}
