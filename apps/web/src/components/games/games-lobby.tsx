'use client';

import Link from 'next/link';
import { lumensFromStroops } from '@takapp/shared/money';
import { formatAmount, useI18n } from '../../lib/i18n';
import { trpc } from '../../lib/trpc/trpc';

export function GamesLobby() {
  const { t, locale } = useI18n();
  const list = trpc.games.list.useQuery();

  if (list.isPending) {
    return <p className="opacity-60">{t('games.loading')}</p>;
  }

  if (list.isError || !list.data) {
    return <p className="opacity-60">{t('games.unavailable')}</p>;
  }

  if (list.data.length === 0) {
    return <p className="opacity-60">{t('games.noGames')}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {list.data.map((game) => (
        <Link
          key={game.gameKey}
          href={`/games/${game.gameKey}`}
          className="flex flex-col gap-1 rounded-2xl bg-coffee-900 p-4 shadow transition-colors hover:bg-coffee-800"
        >
          <h2 className="font-semibold text-coffee-100">{t(game.titleKey)}</h2>
          <p className="text-sm opacity-70">{t(game.descriptionKey)}</p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs opacity-60">
            <span>
              {t('games.playFee')}: {formatAmount(locale, lumensFromStroops(game.settings.paidPlayFee))} TAK
            </span>
            <span>
              {t('games.winPrize')}: {formatAmount(locale, lumensFromStroops(game.settings.prizeTak))} TAK
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
