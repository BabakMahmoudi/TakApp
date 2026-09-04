'use client';

import { useState } from 'react';
import { lumensFromStroops, stroopsFromLumens } from '@takapp/shared/money';
import { getCurrentPosition } from '../lib/geo';
import { useI18n } from '../lib/i18n';
import { trpc } from '../lib/trpc/trpc';

const inputClass = 'rounded-md border border-coffee-700 bg-coffee-950 px-3 py-2 text-coffee-100';
const buttonClass = 'rounded-md bg-coffee-600 px-3 py-1.5 text-sm font-medium text-coffee-50 disabled:opacity-50';

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

interface MenuRow {
  name: string;
  price: string;
}

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
        <ShopEditor key={shop.id} shop={shop} onChanged={() => void mineQuery.refetch()} />
      ))}
    </div>
  );
}

function ShopEditor({ shop, onChanged }: { shop: Shop; onChanged: () => void }) {
  const { t } = useI18n();
  const updateMutation = trpc.owner.update.useMutation();
  const saveMenuMutation = trpc.owner.saveMenu.useMutation();
  const [name, setName] = useState(shop.name);
  const [address, setAddress] = useState(shop.address ?? '');
  const [quote, setQuote] = useState(shop.quoteOfTheDay ?? '');
  const [latitude, setLatitude] = useState(shop.latitude != null ? String(shop.latitude) : '');
  const [longitude, setLongitude] = useState(shop.longitude != null ? String(shop.longitude) : '');
  const [menuRows, setMenuRows] = useState<MenuRow[]>(
    shop.menu.map((item) => ({ name: item.name, price: lumensFromStroops(item.price) })),
  );
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  function parseLocation(): { latitude: number | null; longitude: number | null } | undefined {
    const latText = latitude.trim();
    const lngText = longitude.trim();
    const latitudeValue = latText === '' ? null : Number(latText);
    const longitudeValue = lngText === '' ? null : Number(lngText);
    if ((latText !== '' && !Number.isFinite(latitudeValue)) || (lngText !== '' && !Number.isFinite(longitudeValue))) {
      return undefined;
    }
    return { latitude: latitudeValue, longitude: longitudeValue };
  }

  async function save(): Promise<void> {
    setError(null);
    const location = parseLocation();
    if (!location) {
      setError(t('owner.invalidLocation'));
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: shop.id,
        name,
        address,
        quoteOfTheDay: quote,
        latitude: location.latitude,
        longitude: location.longitude,
      });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function saveMenu(): Promise<void> {
    setError(null);
    let items;
    try {
      items = menuRows
        .filter((row) => row.name.trim() !== '' || row.price.trim() !== '')
        .map((row) => ({ name: row.name.trim(), price: stroopsFromLumens(row.price.trim()) }));
    } catch {
      setError(t('owner.invalidPrice'));
      return;
    }
    if (items.some((item) => item.name === '')) {
      setError(t('owner.invalidItem'));
      return;
    }
    try {
      await saveMenuMutation.mutateAsync({ shopId: shop.id, items });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function useLocation(): void {
    setError(null);
    setLocating(true);
    void getCurrentPosition()
      .then((position) => {
        setLatitude(String(position.latitude));
        setLongitude(String(position.longitude));
      })
      .catch(() => setError(t('owner.locationError')))
      .finally(() => setLocating(false));
  }

  return (
    <div className="rounded-xl bg-coffee-900 p-4 shadow">
      <h3 className="mb-2 text-base font-semibold text-coffee-100">{shop.name}</h3>
      <div className="flex flex-col gap-2">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('owner.name')} className={inputClass} />
        <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder={t('owner.address')} className={inputClass} />
        <input value={quote} onChange={(event) => setQuote(event.target.value)} placeholder={t('owner.quote')} className={inputClass} />
        <div className="flex gap-2">
          <input
            value={latitude}
            onChange={(event) => setLatitude(event.target.value)}
            inputMode="decimal"
            placeholder={t('owner.latitude')}
            className={`${inputClass} flex-1`}
          />
          <input
            value={longitude}
            onChange={(event) => setLongitude(event.target.value)}
            inputMode="decimal"
            placeholder={t('owner.longitude')}
            className={`${inputClass} flex-1`}
          />
        </div>
        <button onClick={useLocation} disabled={locating} className="rounded-md border border-coffee-700 px-3 py-1.5 text-sm text-coffee-200 disabled:opacity-50">
          {locating ? '…' : t('owner.useMyLocation')}
        </button>
        <button onClick={() => void save()} disabled={updateMutation.isPending || name.trim() === ''} className={buttonClass}>
          {updateMutation.isPending ? t('owner.saving') : t('owner.save')}
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <p className="text-xs font-medium text-coffee-300">{t('owner.menu')}</p>
        {menuRows.map((row, index) => (
          <div key={index} className="flex gap-2">
            <input
              value={row.name}
              onChange={(event) => setMenuRows(menuRows.map((r, i) => (i === index ? { ...r, name: event.target.value } : r)))}
              placeholder={t('owner.menuItemName')}
              className={`${inputClass} flex-1`}
            />
            <input
              value={row.price}
              onChange={(event) => setMenuRows(menuRows.map((r, i) => (i === index ? { ...r, price: event.target.value } : r)))}
              inputMode="decimal"
              placeholder={t('owner.menuItemPrice')}
              className={`${inputClass} w-28`}
            />
            <button
              onClick={() => setMenuRows(menuRows.filter((_, i) => i !== index))}
              className="rounded-md border border-red-900 px-2 py-1 text-xs text-red-400"
            >
              {t('owner.remove')}
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <button
            onClick={() => setMenuRows([...menuRows, { name: '', price: '' }])}
            className="rounded-md border border-coffee-700 px-3 py-1.5 text-sm text-coffee-200"
          >
            {t('owner.addItem')}
          </button>
          <button onClick={() => void saveMenu()} disabled={saveMenuMutation.isPending} className={buttonClass}>
            {saveMenuMutation.isPending ? t('owner.saving') : t('owner.saveMenu')}
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
