'use client';

import { useCallback, useEffect, useState } from 'react';
import { lumensFromStroops, stroopsFromLumens } from '@takapp/shared/money';
import { getCurrentPosition } from '../lib/geo';
import { useI18n } from '../lib/i18n';
import { clearAdminToken, getAdminToken, saveAdminToken } from '../lib/storage';
import { trpc } from '../lib/trpc/trpc';
import { useWallet } from '../lib/wallet-provider';

type View = 'enroll' | 'stepup' | 'manage';

function isAdminAuthError(error: unknown): boolean {
  const code = (error as { data?: { code?: string } }).data?.code;
  return code === 'UNAUTHORIZED' || code === 'FORBIDDEN';
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const inputClass = 'rounded-md border border-coffee-700 bg-coffee-950 px-3 py-2 text-coffee-100';
const buttonClass = 'rounded-md bg-coffee-600 px-3 py-1.5 text-sm font-medium text-coffee-50 disabled:opacity-50';

export default function AdminPanel() {
  const { adminStatusQuery } = useWallet();
  const { t } = useI18n();
  const [view, setView] = useState<View>(() => (getAdminToken() ? 'manage' : 'stepup'));

  const handleAuthError = useCallback((error: unknown): void => {
    if (!isAdminAuthError(error)) return;
    clearAdminToken();
    setView('stepup');
  }, []);

  if (!adminStatusQuery.data) return null;
  if (!adminStatusQuery.data.isAdmin) {
    return <p className="text-sm text-red-400">{t('admin.notAuthorized')}</p>;
  }

  return (
    <section className="rounded-xl bg-coffee-900 p-4 shadow">
      <h2 className="mb-3 text-lg font-semibold text-coffee-100">{t('admin.title')}</h2>
      {view === 'enroll' && <EnrollView onDone={() => setView('stepup')} onAuthError={handleAuthError} />}
      {view === 'stepup' && (
        <StepUpView
          totpRequired={adminStatusQuery.data.totpRequired}
          onDone={(token) => {
            saveAdminToken(token);
            setView('manage');
          }}
          onAuthError={handleAuthError}
        />
      )}
      {view === 'manage' && <ManageView onAuthError={handleAuthError} />}
    </section>
  );
}

function EnrollView({ onDone, onAuthError }: { onDone: () => void; onAuthError: (error: unknown) => void }) {
  const { t } = useI18n();
  const enrollMutation = trpc.admin.enrollTotp.useMutation();
  const confirmMutation = trpc.admin.confirmTotp.useMutation();
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function start(): Promise<void> {
    setError(null);
    try {
      const result = await enrollMutation.mutateAsync();
      setSecret(result.secret);
      setUri(result.otpauthUri);
    } catch (cause) {
      onAuthError(cause);
      setError(message(cause));
    }
  }

  async function confirm(): Promise<void> {
    if (!secret) return;
    setError(null);
    try {
      await confirmMutation.mutateAsync({ code, secret });
      onDone();
    } catch (cause) {
      onAuthError(cause);
      setError(message(cause));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {!secret ? (
        <button onClick={() => void start()} disabled={enrollMutation.isPending} className={buttonClass}>
          {enrollMutation.isPending ? t('admin.generating') : t('admin.enrollTotp')}
        </button>
      ) : (
        <>
          <p className="text-xs text-coffee-300">{t('admin.scanQr')}</p>
          <code className="break-all rounded bg-coffee-950 p-2 text-[10px] text-coffee-100">{uri}</code>
          <p className="text-xs text-coffee-300">{t('admin.orEnterKey')}</p>
          <code className="break-all rounded bg-coffee-950 p-2 font-mono text-xs text-coffee-100">{secret}</code>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            maxLength={6}
            placeholder={t('admin.sixDigitCode')}
            className={inputClass}
          />
          <button onClick={() => void confirm()} disabled={confirmMutation.isPending || code.length !== 6} className={buttonClass}>
            {confirmMutation.isPending ? t('admin.verifying') : t('admin.confirm')}
          </button>
        </>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

function StepUpView({
  totpRequired,
  onDone,
  onAuthError,
}: {
  totpRequired: boolean;
  onDone: (token: string) => void;
  onAuthError: (error: unknown) => void;
}) {
  const { t } = useI18n();
  const stepUpMutation = trpc.admin.stepUp.useMutation();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (value: string): Promise<void> => {
      setError(null);
      try {
        const result = await stepUpMutation.mutateAsync({ code: value });
        onDone(result.token);
      } catch (cause) {
        onAuthError(cause);
        setError(message(cause));
      }
    },
    [stepUpMutation, onDone, onAuthError],
  );

  useEffect(() => {
    if (!totpRequired) void submit('000000');
  }, [totpRequired, submit]);

  function handleSubmit(): void {
    void submit(code);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-coffee-300">
        {totpRequired ? t('admin.enterCodePrompt') : t('admin.unlocking')}
      </p>
      {totpRequired && (
        <>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            maxLength={6}
            placeholder={t('admin.sixDigitCode')}
            className={inputClass}
          />
          <button
            onClick={handleSubmit}
            disabled={stepUpMutation.isPending || code.length !== 6}
            className={buttonClass}
          >
            {stepUpMutation.isPending ? t('admin.checking') : t('admin.verify')}
          </button>
        </>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

function ManageView({ onAuthError }: { onAuthError: (error: unknown) => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'shops' | 'users'>('shops');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <button
          onClick={() => setTab('shops')}
          className={`rounded-md px-3 py-1.5 text-sm ${tab === 'shops' ? 'bg-coffee-600 text-coffee-50' : 'border border-coffee-700 text-coffee-200'}`}
        >
          {t('admin.shops')}
        </button>
        <button
          onClick={() => setTab('users')}
          className={`rounded-md px-3 py-1.5 text-sm ${tab === 'users' ? 'bg-coffee-600 text-coffee-50' : 'border border-coffee-700 text-coffee-200'}`}
        >
          {t('admin.users')}
        </button>
      </div>
      {tab === 'shops' ? <ShopsTab onAuthError={onAuthError} /> : <UsersTab onAuthError={onAuthError} />}
    </div>
  );
}

function ShopsTab({ onAuthError }: { onAuthError: (error: unknown) => void }) {
  const { t } = useI18n();
  const shopsQuery = trpc.admin.listShops.useQuery(undefined, { retry: false });
  const createMutation = trpc.admin.createShop.useMutation();
  const disableMutation = trpc.admin.disableShop.useMutation();
  const updateMutation = trpc.admin.updateShop.useMutation();
  const saveMenuMutation = trpc.admin.saveMenu.useMutation();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [quote, setQuote] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [ownerPublicKey, setOwnerPublicKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editQuote, setEditQuote] = useState('');
  const [editLatitude, setEditLatitude] = useState('');
  const [editLongitude, setEditLongitude] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editOwnerPublicKey, setEditOwnerPublicKey] = useState('');
  const [editMenuRows, setEditMenuRows] = useState<{ name: string; price: string }[]>([]);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (shopsQuery.error) onAuthError(shopsQuery.error);
  }, [shopsQuery.error, onAuthError]);

  function parseLocation(
    lat: string,
    lng: string,
  ): { latitude: number | null; longitude: number | null } | undefined {
    const latText = lat.trim();
    const lngText = lng.trim();
    const latitudeValue = latText === '' ? null : Number(latText);
    const longitudeValue = lngText === '' ? null : Number(lngText);
    if (
      (latText !== '' && !Number.isFinite(latitudeValue)) ||
      (lngText !== '' && !Number.isFinite(longitudeValue))
    ) {
      return undefined;
    }
    return { latitude: latitudeValue, longitude: longitudeValue };
  }

  async function create(): Promise<void> {
    setError(null);
    const location = parseLocation(latitude, longitude);
    if (!location) {
      setError(t('admin.invalidLocation'));
      return;
    }
    try {
      await createMutation.mutateAsync({
        name,
        address: address || undefined,
        quoteOfTheDay: quote || undefined,
        latitude: location.latitude,
        longitude: location.longitude,
        ownerPublicKey: ownerPublicKey || undefined,
      });
      setName('');
      setAddress('');
      setQuote('');
      setLatitude('');
      setLongitude('');
      setOwnerPublicKey('');
      await shopsQuery.refetch();
    } catch (cause) {
      onAuthError(cause);
      setError(message(cause));
    }
  }

  async function disable(id: number): Promise<void> {
    setError(null);
    try {
      await disableMutation.mutateAsync({ id });
      await shopsQuery.refetch();
    } catch (cause) {
      onAuthError(cause);
      setError(message(cause));
    }
  }

  function startEdit(id: number): void {
    const shop = shopsQuery.data?.shops.find((entry) => entry.id === id);
    if (!shop) return;
    setEditingId(id);
    setEditName(shop.name);
    setEditAddress(shop.address ?? '');
    setEditQuote(shop.quoteOfTheDay ?? '');
    setEditLatitude(shop.latitude != null ? String(shop.latitude) : '');
    setEditLongitude(shop.longitude != null ? String(shop.longitude) : '');
    setEditActive(shop.isActive);
    setEditOwnerPublicKey(shop.ownerPublicKey ?? '');
    setEditMenuRows(shop.menu.map((item) => ({ name: item.name, price: lumensFromStroops(item.price) })));
    setError(null);
  }

  async function saveEdit(): Promise<void> {
    if (editingId === null) return;
    setError(null);
    const location = parseLocation(editLatitude, editLongitude);
    if (!location) {
      setError(t('admin.invalidLocation'));
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: editingId,
        name: editName,
        address: editAddress || undefined,
        quoteOfTheDay: editQuote || undefined,
        latitude: location.latitude,
        longitude: location.longitude,
        isActive: editActive,
        ownerPublicKey: editOwnerPublicKey,
      });
      setEditingId(null);
      await shopsQuery.refetch();
    } catch (cause) {
      onAuthError(cause);
      setError(message(cause));
    }
  }

  async function saveMenu(shopId: number): Promise<void> {
    setError(null);
    let items;
    try {
      items = editMenuRows
        .filter((row) => row.name.trim() !== '' || row.price.trim() !== '')
        .map((row) => ({ name: row.name.trim(), price: stroopsFromLumens(row.price.trim()) }));
    } catch {
      setError(t('admin.invalidPrice'));
      return;
    }
    if (items.some((item) => item.name === '')) {
      setError(t('admin.invalidItem'));
      return;
    }
    try {
      await saveMenuMutation.mutateAsync({ shopId, items });
      await shopsQuery.refetch();
    } catch (cause) {
      onAuthError(cause);
      setError(message(cause));
    }
  }

  function useLocation(): void {
    setError(null);
    setLocating(true);
    void getCurrentPosition()
      .then((position) => {
        setEditLatitude(String(position.latitude));
        setEditLongitude(String(position.longitude));
      })
      .catch(() => setError(t('admin.locationError')))
      .finally(() => setLocating(false));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('admin.shopName')} className={inputClass} />
        <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder={t('admin.address')} className={inputClass} />
        <input value={quote} onChange={(event) => setQuote(event.target.value)} placeholder={t('admin.quote')} className={inputClass} />
        <div className="flex gap-2">
          <input
            value={latitude}
            onChange={(event) => setLatitude(event.target.value)}
            inputMode="decimal"
            placeholder={t('admin.latitude')}
            className={`${inputClass} flex-1`}
          />
          <input
            value={longitude}
            onChange={(event) => setLongitude(event.target.value)}
            inputMode="decimal"
            placeholder={t('admin.longitude')}
            className={`${inputClass} flex-1`}
          />
        </div>
        <input
          value={ownerPublicKey}
          onChange={(event) => setOwnerPublicKey(event.target.value)}
          placeholder={t('admin.ownerPublicKeyOptional')}
          className={inputClass}
        />
        <button onClick={() => void create()} disabled={createMutation.isPending || name.length === 0} className={buttonClass}>
          {createMutation.isPending ? t('admin.creating') : t('admin.createShop')}
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <ul className="divide-y divide-coffee-800">
        {shopsQuery.data?.shops.map((shop) => (
          <li key={shop.id} className="py-2">
            {editingId === shop.id ? (
              <div className="flex flex-col gap-2 rounded-md bg-coffee-950 p-2">
                <input value={editName} onChange={(event) => setEditName(event.target.value)} placeholder={t('admin.name')} className={inputClass} />
                <input
                  value={editAddress}
                  onChange={(event) => setEditAddress(event.target.value)}
                  placeholder={t('admin.address')}
                  className={inputClass}
                />
                <input
                  value={editQuote}
                  onChange={(event) => setEditQuote(event.target.value)}
                  placeholder={t('admin.quote')}
                  className={inputClass}
                />
                <div className="flex gap-2">
                  <input
                    value={editLatitude}
                    onChange={(event) => setEditLatitude(event.target.value)}
                    inputMode="decimal"
                    placeholder={t('admin.latitude')}
                    className={`${inputClass} flex-1`}
                  />
                  <input
                    value={editLongitude}
                    onChange={(event) => setEditLongitude(event.target.value)}
                    inputMode="decimal"
                    placeholder={t('admin.longitude')}
                    className={`${inputClass} flex-1`}
                  />
                </div>
                <button
                  onClick={useLocation}
                  disabled={locating}
                  className="rounded-md border border-coffee-700 px-3 py-1.5 text-sm text-coffee-200 disabled:opacity-50"
                >
                  {locating ? '…' : t('admin.useMyLocation')}
                </button>
                <input
                  value={editOwnerPublicKey}
                  onChange={(event) => setEditOwnerPublicKey(event.target.value)}
                  placeholder={t('admin.ownerPublicKey')}
                  className={inputClass}
                />
                <label className="flex items-center gap-2 text-xs text-coffee-300">
                  <input
                    type="checkbox"
                    checked={editActive}
                    onChange={(event) => setEditActive(event.target.checked)}
                  />
                  {t('admin.active')}
                </label>

                <div className="flex flex-col gap-2 border-t border-coffee-800 pt-2">
                  <p className="text-xs font-medium text-coffee-300">{t('admin.menu')}</p>
                  {editMenuRows.map((row, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        value={row.name}
                        onChange={(event) =>
                          setEditMenuRows(editMenuRows.map((r, i) => (i === index ? { ...r, name: event.target.value } : r)))
                        }
                        placeholder={t('admin.menuItemName')}
                        className={`${inputClass} flex-1`}
                      />
                      <input
                        value={row.price}
                        onChange={(event) =>
                          setEditMenuRows(editMenuRows.map((r, i) => (i === index ? { ...r, price: event.target.value } : r)))
                        }
                        inputMode="decimal"
                        placeholder={t('admin.menuItemPrice')}
                        className={`${inputClass} w-28`}
                      />
                      <button
                        onClick={() => setEditMenuRows(editMenuRows.filter((_, i) => i !== index))}
                        className="rounded-md border border-red-900 px-2 py-1 text-xs text-red-400"
                      >
                        {t('admin.remove')}
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditMenuRows([...editMenuRows, { name: '', price: '' }])}
                      className="rounded-md border border-coffee-700 px-3 py-1.5 text-sm text-coffee-200"
                    >
                      {t('admin.addItem')}
                    </button>
                    <button
                      onClick={() => void saveMenu(shop.id)}
                      disabled={saveMenuMutation.isPending}
                      className={buttonClass}
                    >
                      {saveMenuMutation.isPending ? t('admin.saving') : t('admin.saveMenu')}
                    </button>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => void saveEdit()}
                    disabled={updateMutation.isPending || editName.length === 0}
                    className={buttonClass}
                  >
                    {updateMutation.isPending ? t('admin.saving') : t('admin.save')}
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="rounded-md border border-coffee-700 px-3 py-1.5 text-sm text-coffee-200"
                  >
                    {t('admin.cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-coffee-100">
                    {shop.name} {shop.isActive ? '' : t('admin.disabled')}
                  </p>
                  <p className="text-xs text-coffee-400">{shop.address ?? '—'}</p>
                  {shop.quoteOfTheDay && <p className="text-xs italic text-coffee-400">{shop.quoteOfTheDay}</p>}
                  {shop.ownerPublicKey && (
                    <p className="font-mono text-[10px] text-coffee-400">{shop.ownerPublicKey.slice(0, 16)}…</p>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => startEdit(shop.id)}
                    className="rounded-md border border-coffee-700 px-2 py-1 text-xs text-coffee-200"
                  >
                    {t('admin.edit')}
                  </button>
                  {shop.isActive && (
                    <button
                      onClick={() => void disable(shop.id)}
                      disabled={disableMutation.isPending}
                      className="rounded-md border border-red-900 px-2 py-1 text-xs text-red-400"
                    >
                      {t('admin.disable')}
                    </button>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
        {(shopsQuery.data?.shops.length ?? 0) === 0 && <li className="py-2 text-sm text-coffee-300">{t('admin.noShops')}</li>}
      </ul>
    </div>
  );
}

function UsersTab({ onAuthError }: { onAuthError: (error: unknown) => void }) {
  const { t } = useI18n();
  const adminsQuery = trpc.admin.listAdmins.useQuery(undefined, { retry: false });
  const promoteMutation = trpc.admin.promote.useMutation();
  const demoteMutation = trpc.admin.demote.useMutation();
  const [publicKey, setPublicKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (adminsQuery.error) onAuthError(adminsQuery.error);
  }, [adminsQuery.error, onAuthError]);

  async function promote(): Promise<void> {
    setError(null);
    try {
      await promoteMutation.mutateAsync({ publicKey });
      setPublicKey('');
      await adminsQuery.refetch();
    } catch (cause) {
      onAuthError(cause);
      setError(message(cause));
    }
  }

  async function demote(publicKey: string): Promise<void> {
    setError(null);
    try {
      await demoteMutation.mutateAsync({ publicKey });
      await adminsQuery.refetch();
    } catch (cause) {
      onAuthError(cause);
      setError(message(cause));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <input
          value={publicKey}
          onChange={(event) => setPublicKey(event.target.value)}
          placeholder={t('admin.publicKeyToPromote')}
          className={inputClass}
        />
        <button onClick={() => void promote()} disabled={promoteMutation.isPending || publicKey.length === 0} className={buttonClass}>
          {promoteMutation.isPending ? t('admin.promoting') : t('admin.promote')}
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <ul className="divide-y divide-coffee-800">
        {adminsQuery.data?.admins.map((admin) => (
          <li key={admin.id} className="flex items-center justify-between gap-2 py-2">
            <div>
              <p className="text-xs font-mono text-coffee-100">{admin.stellarPublicKey}</p>
              <p className="text-xs text-coffee-400">{admin.email ?? admin.displayName ?? '—'}</p>
            </div>
            <button
              onClick={() => void demote(admin.stellarPublicKey)}
              disabled={demoteMutation.isPending}
              className="rounded-md border border-red-900 px-2 py-1 text-xs text-red-400"
            >
              {t('admin.demote')}
            </button>
          </li>
        ))}
        {(adminsQuery.data?.admins.length ?? 0) === 0 && <li className="py-2 text-sm text-coffee-300">{t('admin.noAdmins')}</li>}
      </ul>
    </div>
  );
}
