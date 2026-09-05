'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentPosition, nearestShopWithinMeters } from '../lib/geo';
import { useI18n } from '../lib/i18n';
import { trpc } from '../lib/trpc/trpc';

export const AUTO_SELECT_MAX_METERS = 50;

export default function BuyCoffeeButton() {
  const router = useRouter();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const shopsQuery = trpc.shops.listForMe.useQuery(undefined, { enabled: false });

  async function onBuy(): Promise<void> {
    setBusy(true);
    try {
      const position = await getCurrentPosition();
      const result = await shopsQuery.refetch();
      const shops = result.data?.shops ?? [];
      const nearestId = nearestShopWithinMeters(
        shops.map((shop) => ({ id: shop.id, latitude: shop.latitude, longitude: shop.longitude })),
        position,
        AUTO_SELECT_MAX_METERS,
      );
      router.push(nearestId !== null ? `/order/${nearestId}` : '/buy');
    } catch {
      router.push('/buy');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={() => void onBuy()}
      disabled={busy}
      className="rounded-xl bg-coffee-900 p-6 shadow text-center text-lg font-semibold text-coffee-100 disabled:opacity-50"
    >
      {busy ? '…' : t('home.buyCoffee')}
    </button>
  );
}
