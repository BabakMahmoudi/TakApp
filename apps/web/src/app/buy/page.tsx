'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { lumensFromStroops } from '@takapp/shared/money';
import { distanceMeters, getCurrentPosition } from '../../lib/geo';
import type { GeoPoint } from '../../lib/geo';
import { formatAmount, useI18n } from '../../lib/i18n';
import { trpc } from '../../lib/trpc/trpc';
import { useWallet } from '../../lib/wallet-provider';

interface MenuItem {
  id: number;
  name: string;
  price: string;
}

interface Shop {
  id: number;
  name: string;
  address: string | null;
  quoteOfTheDay: string | null;
  latitude: number | null;
  longitude: number | null;
  ownerPublicKey: string | null;
  menu: MenuItem[];
}

export default function BuyPage() {
  const { session, busy, error, setError, signPayment, submitPayment } = useWallet();
  const { t, locale } = useI18n();
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const shopsQuery = trpc.shops.list.useQuery(undefined, {
    enabled: !!session,
    retry: false,
  });

  const formatNumber = (n: number): string =>
    new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', { maximumFractionDigits: 0 }).format(n);

  const sorted = useMemo(() => {
    const shops = shopsQuery.data?.shops ?? [];
    if (!location) return shops.map((shop) => ({ shop, distance: null as number | null }));
    return shops
      .map((shop) => ({
        shop,
        distance:
          shop.latitude != null && shop.longitude != null
            ? distanceMeters(location, { latitude: shop.latitude, longitude: shop.longitude })
            : null,
      }))
      .sort((a, b) => (a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY));
  }, [shopsQuery.data, location]);

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

  function useLocation(): void {
    setLocationError(null);
    setLocating(true);
    void getCurrentPosition()
      .then((position) => setLocation(position))
      .catch(() => setLocationError(t('buy.locationError')))
      .finally(() => setLocating(false));
  }

  function buyItem(shop: Shop, item: MenuItem): void {
    setError(null);
    if (!shop.ownerPublicKey) {
      setError({ message: t('buy.error.noAccount') });
      return;
    }
    signPayment(async (secretKey) => {
      await submitPayment({
        secretKey,
        destination: shop.ownerPublicKey as string,
        stroops: item.price,
        coffeeShopId: shop.id,
        menuItemId: item.id,
      });
    });
  }

  const nearestId = sorted.find((entry) => entry.distance !== null)?.shop.id;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
      <section className="rounded-xl bg-coffee-900 p-6 shadow">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-coffee-300">{t('buy.title')}</h2>
          <button
            onClick={useLocation}
            disabled={locating}
            className="rounded-md border border-coffee-700 px-3 py-1.5 text-sm text-coffee-200 disabled:opacity-50"
          >
            {locating ? '…' : t('buy.useMyLocation')}
          </button>
        </div>
        {locationError && <p className="mt-2 text-xs text-coffee-400">{locationError}</p>}
        {shopsQuery.isLoading ? (
          <p className="mt-2 text-coffee-300">{t('buy.loading')}</p>
        ) : shopsQuery.isError ? (
          <p className="mt-2 text-red-400">{shopsQuery.error.message}</p>
        ) : (
          <ul className="mt-2 divide-y divide-coffee-800">
            {sorted.map(({ shop, distance }) => (
              <li key={shop.id} className="py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm text-coffee-100">
                      {shop.name}
                      {shop.id === nearestId && (
                        <span className="ms-2 rounded bg-coffee-700 px-1.5 py-0.5 text-[10px] text-coffee-100">
                          {t('buy.nearest')}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-coffee-400">{shop.address ?? '—'}</p>
                    {distance !== null && (
                      <p className="text-xs text-coffee-400">
                        {formatNumber(Math.round(distance))} {t('buy.distanceUnit')}
                      </p>
                    )}
                    {shop.quoteOfTheDay && (
                      <p className="mt-1 text-xs italic text-coffee-300">{shop.quoteOfTheDay}</p>
                    )}
                  </div>
                </div>
                {shop.menu.length > 0 ? (
                  <div className="mt-2 flex flex-col gap-1.5">
                    <p className="text-xs font-medium text-coffee-300">{t('buy.menu')}</p>
                    {shop.menu.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => buyItem(shop, item)}
                        disabled={busy}
                        className="flex items-center justify-between gap-2 rounded-md border border-coffee-700 px-3 py-1.5 text-start text-sm text-coffee-100 disabled:opacity-50"
                      >
                        <span>{item.name}</span>
                        <span className="font-mono text-xs text-coffee-300">
                          {formatAmount(locale, lumensFromStroops(item.price))} TAK
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-coffee-400">{t('buy.noMenu')}</p>
                )}
              </li>
            ))}
            {(shopsQuery.data?.shops.length ?? 0) === 0 && (
              <li className="py-3 text-coffee-300">{t('buy.noShops')}</li>
            )}
          </ul>
        )}
      </section>
      {error && <p className="text-sm text-red-400">{error.message}</p>}
    </main>
  );
}
