'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '../../lib/i18n';
import { trpc } from '../../lib/trpc/trpc';
import { useWallet } from '../../lib/wallet-provider';

export default function ProfilePage() {
  const { session, error, setError } = useWallet();
  const { locale, setLocale, t } = useI18n();
  const meQuery = trpc.users.me.useQuery(undefined, {
    enabled: !!session,
    retry: false,
  });
  const updateProfileMutation = trpc.users.updateProfile.useMutation();

  const [profileName, setProfileName] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    if (meQuery.data) setProfileName(meQuery.data.displayName ?? '');
  }, [meQuery.data]);

  async function saveProfile(): Promise<void> {
    setError(null);
    try {
      const result = await updateProfileMutation.mutateAsync({ displayName: profileName.trim() });
      setProfileName(result.displayName);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2000);
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : String(cause) });
    }
  }

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
      <h1 className="text-xl font-semibold text-coffee-100">{t('profile.title')}</h1>
      <section className="rounded-xl bg-coffee-900 p-6 shadow">
        <h2 className="text-sm font-medium text-coffee-300">{t('profile.displayName')}</h2>
        <div className="mt-3 flex gap-2">
          <input
            value={profileName}
            onChange={(event) => {
              setProfileName(event.target.value);
              setProfileSaved(false);
            }}
            maxLength={50}
            placeholder={t('profile.displayName')}
            className="flex-1 rounded-md border border-coffee-700 bg-coffee-950 px-3 py-2 text-coffee-100"
          />
          <button
            onClick={() => void saveProfile()}
            disabled={updateProfileMutation.isPending || profileName.trim().length === 0}
            className="rounded-md bg-coffee-600 px-4 py-2 text-sm font-medium text-coffee-50 disabled:opacity-50"
          >
            {profileSaved ? t('profile.saved') : t('profile.save')}
          </button>
        </div>
        {meQuery.data?.email && <p className="mt-3 text-xs text-coffee-400">{t('profile.email')}: {meQuery.data.email}</p>}
        {meQuery.data?.phone && <p className="mt-1 text-xs text-coffee-400">{t('profile.phone')}: {meQuery.data.phone}</p>}
      </section>
      <section className="rounded-xl bg-coffee-900 p-6 shadow">
        <h2 className="text-sm font-medium text-coffee-300">{t('profile.language')}</h2>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setLocale('en')}
            className={`rounded-md px-4 py-2 text-sm font-medium ${
              locale === 'en' ? 'bg-coffee-600 text-coffee-50' : 'border border-coffee-700 text-coffee-200'
            }`}
          >
            {t('profile.languageEnglish')}
          </button>
          <button
            onClick={() => setLocale('fa')}
            className={`rounded-md px-4 py-2 text-sm font-medium ${
              locale === 'fa' ? 'bg-coffee-600 text-coffee-50' : 'border border-coffee-700 text-coffee-200'
            }`}
          >
            {t('profile.languagePersian')}
          </button>
        </div>
      </section>
      {error && <p className="text-sm text-red-400">{error.message}</p>}
    </main>
  );
}
