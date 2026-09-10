'use client';

import Link from 'next/link';
import { lumensFromStroops } from '@takapp/shared/money';
import { formatAmountLatin, useI18n } from '../lib/i18n';
import { trpc } from '../lib/trpc/trpc';
import type { OwnerShop } from './owner-shop-editor';
import TakSymbol from './tak-symbol';

export default function OwnerPanel() {
  const { t } = useI18n();
  const mineQuery = trpc.owner.mine.useQuery(undefined, { retry: false });

  if (mineQuery.isLoading) return <p className="text-sm text-coffee-300">{t('owner.loading')}</p>;
  if (mineQuery.isError) return <p className="text-sm text-red-400">{mineQuery.error.message}</p>;
  if (!mineQuery.data || mineQuery.data.shops.length === 0) {
    return <p className="text-sm text-coffee-300">{t('owner.noShops')}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {mineQuery.data.shops.map((shop) => (
        <ShopInfo key={shop.id} shop={shop} />
      ))}
    </div>
  );
}

function ShopInfo({ shop }: { shop: OwnerShop }) {
  const { t } = useI18n();

  return (
    <div className="rounded-xl bg-coffee-900 p-4 shadow">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-coffee-100">{shop.name}</h3>
        <Link
          href="/owner/edit"
          className="rounded-md bg-coffee-600 px-3 py-1.5 text-sm font-medium text-coffee-50"
        >
          {t('owner.edit')}
        </Link>
      </div>

      <dl className="mt-3 flex flex-col gap-2 text-sm">
        {shop.address && (
          <div>
            <dt className="text-xs text-coffee-400">{t('owner.address')}</dt>
            <dd className="text-coffee-100">{shop.address}</dd>
          </div>
        )}
        {shop.quoteOfTheDay && (
          <div>
            <dt className="text-xs text-coffee-400">{t('owner.quote')}</dt>
            <dd className="text-coffee-100">{shop.quoteOfTheDay}</dd>
          </div>
        )}
        {(shop.latitude != null || shop.longitude != null) && (
          <div>
            <dt className="text-xs text-coffee-400">{t('owner.location')}</dt>
            <dd className="font-mono text-coffee-100">
              {shop.latitude ?? '—'}, {shop.longitude ?? '—'}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-4">
        <p className="text-xs font-medium text-coffee-300">{t('owner.menu')}</p>
        {shop.menu.length === 0 ? (
          <p className="mt-1 text-sm text-coffee-400">{t('owner.noMenu')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-coffee-800">
            {shop.menu.map((item) => (
              <li key={item.id} className="flex items-center justify-between py-2">
                <span className="text-sm text-coffee-100">{item.name}</span>
                <span className="flex items-center gap-1 font-mono text-sm text-coffee-300">
                  {formatAmountLatin(lumensFromStroops(item.price))}
                  <TakSymbol className="h-3.5 w-3.5" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
