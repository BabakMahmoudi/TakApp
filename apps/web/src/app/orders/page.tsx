'use client';

import { useState } from 'react';
import Link from 'next/link';
import { lumensFromStroops } from '@takapp/shared/money';
import { formatAmount, useI18n } from '../../lib/i18n';
import { useEnablePush } from '../../lib/push';
import { trpc } from '../../lib/trpc/trpc';
import { useWallet } from '../../lib/wallet-provider';

export default function OrdersPage() {
  const { session } = useWallet();
  const { t, locale } = useI18n();
  const enablePush = useEnablePush();
  const [pushState, setPushState] = useState<'idle' | 'enabled' | 'unavailable'>('idle');
  const ordersQuery = trpc.orders.my.useQuery(undefined, { enabled: !!session, retry: false });

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

  async function enableNotifications(): Promise<void> {
    const ok = await enablePush();
    setPushState(ok ? 'enabled' : 'unavailable');
  }

  const formatTime = (ms: number): string =>
    new Date(ms).toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
      day: 'numeric',
      month: 'short',
    });

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
      <section className="rounded-xl bg-coffee-900 p-6 shadow">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold text-coffee-100">{t('orders.title')}</h1>
          <button
            onClick={() => void enableNotifications()}
            className="rounded-md border border-coffee-700 px-3 py-1.5 text-sm text-coffee-200"
          >
            {pushState === 'enabled' ? t('orders.notificationsEnabled') : t('orders.enableNotifications')}
          </button>
        </div>
        {pushState === 'unavailable' && (
          <p className="mt-2 text-xs text-coffee-400">{t('orders.notificationsUnavailable')}</p>
        )}
        {ordersQuery.isLoading ? (
          <p className="mt-2 text-coffee-300">{t('orders.loading')}</p>
        ) : ordersQuery.isError ? (
          <p className="mt-2 text-red-400">{ordersQuery.error.message}</p>
        ) : (ordersQuery.data?.orders.length ?? 0) === 0 ? (
          <p className="mt-2 text-coffee-300">{t('orders.noOrders')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-coffee-800">
            {ordersQuery.data?.orders.map((order) => (
              <li key={order.id} className="py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm text-coffee-100">{order.shopName}</p>
                    <p className="text-xs text-coffee-400">{order.itemsText}</p>
                    <p className="mt-1 font-mono text-xs text-coffee-300">
                      {formatAmount(locale, lumensFromStroops(order.totalAmount))} TAK ·{' '}
                      {formatTime(order.createdAt)}
                    </p>
                  </div>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] ${
                      order.status === 'ready'
                        ? 'bg-green-900 text-green-200'
                        : 'bg-coffee-700 text-coffee-100'
                    }`}
                  >
                    {order.status === 'ready' ? t('orders.ready') : t('orders.placed')}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
