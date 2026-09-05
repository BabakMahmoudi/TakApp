'use client';

import Link from 'next/link';
import OwnerOrders from '../../components/owner-orders';
import OwnerPanel from '../../components/owner-panel';
import { useI18n } from '../../lib/i18n';
import { useWallet } from '../../lib/wallet-provider';

export default function OwnerPage() {
  const { session } = useWallet();
  const { t } = useI18n();

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
      <h1 className="text-lg font-semibold text-coffee-100">{t('owner.title')}</h1>
      <OwnerPanel />
      <OwnerOrders />
    </main>
  );
}
