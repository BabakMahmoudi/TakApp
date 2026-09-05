'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { addStroops, isZeroStroops, lumensFromStroops, mulStroops } from '@takapp/shared/money';
import { formatAmount, useI18n } from '../../../lib/i18n';
import { useEnablePush } from '../../../lib/push';
import { trpc } from '../../../lib/trpc/trpc';
import { useWallet } from '../../../lib/wallet-provider';

const buttonClass = 'rounded-md bg-coffee-600 px-4 py-2 text-sm font-medium text-coffee-50 disabled:opacity-50';

export default function OrderPage() {
  const params = useParams<{ shopId: string }>();
  const shopId = Number(params.shopId);
  const { session, busy, error, setError, signPayment, submitOrder } = useWallet();
  const { t, locale } = useI18n();
  const enablePush = useEnablePush();
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [placed, setPlaced] = useState<{ orderId: number; totalAmount: string } | null>(null);
  const shopQuery = trpc.shops.get.useQuery(
    { id: shopId },
    { enabled: Number.isInteger(shopId) && shopId > 0, retry: false },
  );

  const shop = shopQuery.data?.shop;
  const menu = useMemo(() => shop?.menu ?? [], [shop]);

  const total = useMemo(() => {
    let sum = '0';
    for (const item of menu) {
      const quantity = quantities[item.id] ?? 0;
      if (quantity > 0) sum = addStroops(sum, mulStroops(item.price, quantity));
    }
    return sum;
  }, [menu, quantities]);

  const items = useMemo(
    () =>
      menu
        .filter((item) => (quantities[item.id] ?? 0) > 0)
        .map((item) => ({ menuItemId: item.id, quantity: quantities[item.id] ?? 0 })),
    [menu, quantities],
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

  if (shopQuery.isLoading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
        <p className="text-coffee-300">{t('order.loading')}</p>
      </main>
    );
  }

  if (shopQuery.isError || !shop) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
        <p className="text-red-400">{shopQuery.error?.message ?? t('order.notFound')}</p>
        <Link href="/buy" className="rounded-md bg-coffee-600 px-4 py-2.5 text-center font-medium text-coffee-50">
          {t('order.selectShop')}
        </Link>
      </main>
    );
  }

  function pay(): void {
    setError(null);
    if (!shop?.ownerPublicKey) {
      setError({ message: t('order.error.noAccount') });
      return;
    }
    if (isZeroStroops(total)) return;
    signPayment(async (secretKey) => {
      const result = await submitOrder({
        secretKey,
        shopId,
        items,
        amount: total,
        ownerPublicKey: shop.ownerPublicKey as string,
      });
      setPlaced(result);
      void enablePush();
    });
  }

  if (placed) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
        <section className="rounded-xl bg-coffee-900 p-6 text-center shadow">
          <p className="text-lg font-semibold text-coffee-100">{t('order.confirmed')}</p>
          <p className="mt-2 text-sm text-coffee-300">
            {formatAmount(locale, lumensFromStroops(placed.totalAmount))} TAK
          </p>
          <Link href="/orders" className="mt-4 inline-block rounded-md bg-coffee-600 px-4 py-2 text-sm font-medium text-coffee-50">
            {t('order.viewOrders')}
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
      <section className="rounded-xl bg-coffee-900 p-6 shadow">
        <h1 className="text-lg font-semibold text-coffee-100">{shop.name}</h1>
        <p className="mt-1 text-xs text-coffee-400">{shop.address ?? '—'}</p>
        {shop.quoteOfTheDay && <p className="mt-2 text-sm italic text-coffee-300">{shop.quoteOfTheDay}</p>}

        <div className="mt-4 flex flex-col gap-2">
          <p className="text-xs font-medium text-coffee-300">{t('order.menu')}</p>
          {menu.length === 0 && <p className="text-xs text-coffee-400">{t('order.emptyCart')}</p>}
          {menu.map((item) => {
            const quantity = quantities[item.id] ?? 0;
            return (
              <div key={item.id} className="flex items-center justify-between gap-2 py-1">
                <div>
                  <p className="text-sm text-coffee-100">{item.name}</p>
                  <p className="font-mono text-xs text-coffee-400">
                    {formatAmount(locale, lumensFromStroops(item.price))} TAK
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      setQuantities((current) => ({ ...current, [item.id]: Math.max(0, (current[item.id] ?? 0) - 1) }))
                    }
                    disabled={quantity === 0}
                    className="rounded-md border border-coffee-700 px-2.5 py-1 text-coffee-200 disabled:opacity-40"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-sm text-coffee-100">{quantity}</span>
                  <button
                    onClick={() =>
                      setQuantities((current) => ({ ...current, [item.id]: Math.min(999, (current[item.id] ?? 0) + 1) }))
                    }
                    className="rounded-md border border-coffee-700 px-2.5 py-1 text-coffee-200"
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-coffee-800 pt-3">
          <p className="text-sm text-coffee-300">{t('order.total')}</p>
          <p className="font-mono text-lg font-semibold text-coffee-100">
            {formatAmount(locale, lumensFromStroops(total))} TAK
          </p>
        </div>

        <div className="mt-4 flex gap-2">
          <Link
            href="/buy"
            className="rounded-md border border-coffee-700 px-4 py-2 text-sm text-coffee-200"
          >
            {t('order.selectShop')}
          </Link>
          <button onClick={pay} disabled={busy || isZeroStroops(total)} className={`${buttonClass} flex-1`}>
            {busy ? '…' : t('order.pay')}
          </button>
        </div>
      </section>
      {error && <p className="text-sm text-red-400">{error.message}</p>}
    </main>
  );
}
