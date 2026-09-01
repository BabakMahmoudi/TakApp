'use client';

import { useCallback, useEffect, useState } from 'react';
import { clearAdminToken, getAdminToken, saveAdminToken } from '../lib/storage';
import { trpc } from '../lib/trpc/trpc';

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
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>(() => (getAdminToken() ? 'manage' : 'stepup'));
  const statusQuery = trpc.admin.status.useQuery(undefined, { retry: false });

  const handleAuthError = useCallback((error: unknown): void => {
    if (!isAdminAuthError(error)) return;
    clearAdminToken();
    setView('stepup');
  }, []);

  if (statusQuery.isLoading || !statusQuery.data) return null;
  if (statusQuery.data.role !== 'admin') return null;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-md border border-coffee-700 px-3 py-1.5 text-sm text-coffee-200">
        Admin
      </button>
    );
  }

  return (
    <section className="rounded-xl bg-coffee-900 p-4 shadow">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-coffee-100">Admin</h2>
        <button onClick={() => setOpen(false)} className="text-sm text-coffee-300">
          Close
        </button>
      </div>
      {view === 'enroll' && <EnrollView onDone={() => setView('stepup')} onAuthError={handleAuthError} />}
      {view === 'stepup' && (
        <StepUpView
          totpRequired={statusQuery.data.totpRequired}
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
          {enrollMutation.isPending ? 'Generating…' : 'Enroll TOTP'}
        </button>
      ) : (
        <>
          <p className="text-xs text-coffee-300">Scan this QR in your authenticator app:</p>
          <code className="break-all rounded bg-coffee-950 p-2 text-[10px] text-coffee-100">{uri}</code>
          <p className="text-xs text-coffee-300">Or enter the setup key manually:</p>
          <code className="break-all rounded bg-coffee-950 p-2 font-mono text-xs text-coffee-100">{secret}</code>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            maxLength={6}
            placeholder="6-digit code"
            className={inputClass}
          />
          <button onClick={() => void confirm()} disabled={confirmMutation.isPending || code.length !== 6} className={buttonClass}>
            {confirmMutation.isPending ? 'Verifying…' : 'Confirm'}
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
        {totpRequired ? 'Enter your 6-digit authenticator code to unlock admin tools.' : 'Unlocking admin tools…'}
      </p>
      {totpRequired && (
        <>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            maxLength={6}
            placeholder="6-digit code"
            className={inputClass}
          />
          <button
            onClick={handleSubmit}
            disabled={stepUpMutation.isPending || code.length !== 6}
            className={buttonClass}
          >
            {stepUpMutation.isPending ? 'Checking…' : 'Verify'}
          </button>
        </>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

function ManageView({ onAuthError }: { onAuthError: (error: unknown) => void }) {
  const [tab, setTab] = useState<'shops' | 'users'>('shops');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <button
          onClick={() => setTab('shops')}
          className={`rounded-md px-3 py-1.5 text-sm ${tab === 'shops' ? 'bg-coffee-600 text-coffee-50' : 'border border-coffee-700 text-coffee-200'}`}
        >
          Shops
        </button>
        <button
          onClick={() => setTab('users')}
          className={`rounded-md px-3 py-1.5 text-sm ${tab === 'users' ? 'bg-coffee-600 text-coffee-50' : 'border border-coffee-700 text-coffee-200'}`}
        >
          Users
        </button>
      </div>
      {tab === 'shops' ? <ShopsTab onAuthError={onAuthError} /> : <UsersTab onAuthError={onAuthError} />}
    </div>
  );
}

function ShopsTab({ onAuthError }: { onAuthError: (error: unknown) => void }) {
  const shopsQuery = trpc.admin.listShops.useQuery(undefined, { retry: false });
  const createMutation = trpc.admin.createShop.useMutation();
  const disableMutation = trpc.admin.disableShop.useMutation();
  const updateMutation = trpc.admin.updateShop.useMutation();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [ownerPublicKey, setOwnerPublicKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editOwnerPublicKey, setEditOwnerPublicKey] = useState('');

  useEffect(() => {
    if (shopsQuery.error) onAuthError(shopsQuery.error);
  }, [shopsQuery.error, onAuthError]);

  async function create(): Promise<void> {
    setError(null);
    try {
      await createMutation.mutateAsync({
        name,
        address: address || undefined,
        ownerPublicKey: ownerPublicKey || undefined,
      });
      setName('');
      setAddress('');
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
    setEditActive(shop.isActive);
    setEditOwnerPublicKey(shop.ownerPublicKey ?? '');
    setError(null);
  }

  async function saveEdit(): Promise<void> {
    if (editingId === null) return;
    setError(null);
    try {
      await updateMutation.mutateAsync({
        id: editingId,
        name: editName,
        address: editAddress || undefined,
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Shop name" className={inputClass} />
        <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Address" className={inputClass} />
        <input
          value={ownerPublicKey}
          onChange={(event) => setOwnerPublicKey(event.target.value)}
          placeholder="Owner public key (optional)"
          className={inputClass}
        />
        <button onClick={() => void create()} disabled={createMutation.isPending || name.length === 0} className={buttonClass}>
          {createMutation.isPending ? 'Creating…' : 'Create shop'}
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <ul className="divide-y divide-coffee-800">
        {shopsQuery.data?.shops.map((shop) => (
          <li key={shop.id} className="py-2">
            {editingId === shop.id ? (
              <div className="flex flex-col gap-2 rounded-md bg-coffee-950 p-2">
                <input value={editName} onChange={(event) => setEditName(event.target.value)} placeholder="Name" className={inputClass} />
                <input
                  value={editAddress}
                  onChange={(event) => setEditAddress(event.target.value)}
                  placeholder="Address"
                  className={inputClass}
                />
                <input
                  value={editOwnerPublicKey}
                  onChange={(event) => setEditOwnerPublicKey(event.target.value)}
                  placeholder="Owner public key"
                  className={inputClass}
                />
                <label className="flex items-center gap-2 text-xs text-coffee-300">
                  <input
                    type="checkbox"
                    checked={editActive}
                    onChange={(event) => setEditActive(event.target.checked)}
                  />
                  Active
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => void saveEdit()}
                    disabled={updateMutation.isPending || editName.length === 0}
                    className={buttonClass}
                  >
                    {updateMutation.isPending ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="rounded-md border border-coffee-700 px-3 py-1.5 text-sm text-coffee-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-coffee-100">
                    {shop.name} {shop.isActive ? '' : '(disabled)'}
                  </p>
                  <p className="text-xs text-coffee-400">{shop.address ?? '—'}</p>
                  {shop.ownerPublicKey && (
                    <p className="font-mono text-[10px] text-coffee-400">{shop.ownerPublicKey.slice(0, 16)}…</p>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => startEdit(shop.id)}
                    className="rounded-md border border-coffee-700 px-2 py-1 text-xs text-coffee-200"
                  >
                    Edit
                  </button>
                  {shop.isActive && (
                    <button
                      onClick={() => void disable(shop.id)}
                      disabled={disableMutation.isPending}
                      className="rounded-md border border-red-900 px-2 py-1 text-xs text-red-400"
                    >
                      Disable
                    </button>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
        {(shopsQuery.data?.shops.length ?? 0) === 0 && <li className="py-2 text-sm text-coffee-300">No shops yet</li>}
      </ul>
    </div>
  );
}

function UsersTab({ onAuthError }: { onAuthError: (error: unknown) => void }) {
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
          placeholder="Public key to promote"
          className={inputClass}
        />
        <button onClick={() => void promote()} disabled={promoteMutation.isPending || publicKey.length === 0} className={buttonClass}>
          {promoteMutation.isPending ? 'Promoting…' : 'Promote'}
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
              Demote
            </button>
          </li>
        ))}
        {(adminsQuery.data?.admins.length ?? 0) === 0 && <li className="py-2 text-sm text-coffee-300">No admins</li>}
      </ul>
    </div>
  );
}
