'use client';

import { useEffect } from 'react';
import { lumensFromStroops } from '@takapp/shared/money';
import { formatAmount, useI18n } from '../lib/i18n';
import { useEnablePush } from '../lib/push';
import { trpc } from '../lib/trpc/trpc';
import TakSymbol from './tak-symbol';

export default function OwnerOrders() {
  const { t, locale } = useI18n();
  const enablePush = useEnablePush();
  const listQuery = trpc.orders.listForOwner.useQuery(undefined, { retry: false });
  const markReadyMutation = trpc.orders.markReady.useMutation();

  useEffect(() => {
    void enablePush();
  }, [enablePush]);

  const orders = listQuery.data?.orders ?? [];

  const formatTime = (ms: number): string =>
    new Date(ms).toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
      day: 'numeric',
      month: 'short',
    });

  return (
    <div className="rounded-xl bg-coffee-900 p-4 shadow">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-coffee-100">{t('ownerOrders.title')}</h2>
        <button
          type="button"
          onClick={() => void listQuery.refetch()}
          disabled={listQuery.isFetching}
          className="rounded-md border border-coffee-700 px-3 py-1.5 text-xs text-coffee-200 disabled:opacity-50"
        >
          {listQuery.isFetching ? '…' : t('ownerOrders.refresh')}
        </button>
      </div>

      {listQuery.isLoading ? (
        <p className="mt-2 text-sm text-coffee-300">{t('ownerOrders.loading')}</p>
      ) : listQuery.isError ? (
        <p className="mt-2 text-sm text-red-400">{listQuery.error.message}</p>
      ) : orders.length === 0 ? (
        <p className="mt-2 text-sm text-coffee-300">{t('ownerOrders.noOrders')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-coffee-800">
          {orders.map((order) => (
            <li key={order.id} className="py-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm text-coffee-100">{order.itemsText}</p>
                  <p className="text-xs text-coffee-400">
                    {order.customerDisplayName ?? order.customerPublicKey.slice(0, 12)}
                  </p>
                  <p className="mt-1 flex items-center gap-1 font-mono text-xs text-coffee-300">
                    <span>{formatAmount(locale, lumensFromStroops(order.totalAmount))}</span>
                    <TakSymbol className="h-3.5 w-3.5" />
                    <span>· {formatTime(order.createdAt)}</span>
                  </p>
                </div>
                {order.status === 'placed' ? (
                  <button
                    onClick={() => void markReadyMutation.mutateAsync({ orderId: order.id }).then(() => listQuery.refetch())}
                    disabled={markReadyMutation.isPending}
                    className="rounded-md bg-coffee-600 px-3 py-1.5 text-xs font-medium text-coffee-50 disabled:opacity-50"
                  >
                    {markReadyMutation.isPending ? '…' : t('ownerOrders.markReady')}
                  </button>
                ) : (
                  <span className="rounded bg-green-900 px-2 py-0.5 text-[10px] text-green-200">
                    {t('ownerOrders.ready')}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {markReadyMutation.isError && (
        <p className="mt-2 text-sm text-red-400">{markReadyMutation.error.message}</p>
      )}
    </div>
  );
}
