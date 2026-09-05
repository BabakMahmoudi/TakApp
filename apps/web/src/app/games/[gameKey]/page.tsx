'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { GameShell } from '../../../components/games/game-shell';
import { isGameKey } from '../../../lib/games';
import { useI18n } from '../../../lib/i18n';
import { useWallet } from '../../../lib/wallet-provider';

export default function GamePage() {
  const { session } = useWallet();
  const { t } = useI18n();
  const params = useParams<{ gameKey: string }>();
  const gameKey = params.gameKey;

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

  if (!isGameKey(gameKey)) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
        <p className="text-coffee-300">{t('games.errors.invalidGame')}</p>
        <Link href="/games" className="rounded-md bg-coffee-600 px-4 py-2.5 text-center font-medium text-coffee-50">
          {t('games.title')}
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
      <GameShell gameKey={gameKey} />
    </main>
  );
}
