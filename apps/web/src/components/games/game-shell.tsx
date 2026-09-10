'use client';

import { useCallback, useState } from 'react';
import { lumensFromStroops } from '@takapp/shared/money';
import { gameErrorKey, type GameKey, type GameParams } from '../../lib/games';
import { formatAmount, useI18n } from '../../lib/i18n';
import { trpc } from '../../lib/trpc/trpc';
import { useWallet } from '../../lib/wallet-provider';
import { SpinWheel } from './spin-wheel';
import { StopClock } from './stop-clock';
import { TapBean } from './tap-bean';

type Phase = 'idle' | 'starting' | 'playing' | 'settling' | 'result';

type ActivePlay = {
  playId: number;
  playType: 'free' | 'paid';
  params: GameParams;
};

type FinishResult = {
  playId: number;
  outcome: 'won' | 'lost' | 'abandoned' | 'payout_failed';
  prize: string;
  score: number | null;
  freePlaysRemaining: number;
};

function typedCode(error: unknown): string | undefined {
  // The server encodes the GameError typed code in `error.message` (see
  // `toTrpcGameError`); `gameErrorKey` maps it to an i18n key.
  const message = error instanceof Error ? error.message : undefined;
  return message;
}

export function GameShell({ gameKey }: { gameKey: GameKey }) {
  const { t, locale } = useI18n();
  const { refetchBalances } = useWallet();
  const utils = trpc.useUtils();
  const list = trpc.games.list.useQuery();
  const history = trpc.games.history.useQuery({}, { enabled: false });
  const start = trpc.games.start.useMutation();
  const finish = trpc.games.finish.useMutation();

  const [phase, setPhase] = useState<Phase>('idle');
  const [active, setActive] = useState<ActivePlay | null>(null);
  const [result, setResult] = useState<FinishResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const game = list.data?.find((entry) => entry.gameKey === gameKey);

  function resumePending() {
    void history.refetch().then(({ data }) => {
      const pending = (data ?? []).find(
        (entry) => entry.gameKey === gameKey && entry.status === 'pending',
      );
      if (pending) {
        setActive({
          playId: pending.id,
          playType: pending.playType as 'free' | 'paid',
          params: pending.params as GameParams,
        });
        setPhase('playing');
      } else {
        setError(t(gameErrorKey('GAME_IN_PROGRESS')));
      }
    });
  }

  function handlePlay() {
    setError(null);
    setPhase('starting');
    start.mutate(
      { gameKey },
      {
        onSuccess: (data) => {
          setActive({ playId: data.playId, playType: data.playType, params: data.params });
          setPhase('playing');
        },
        onError: (err) => {
          const code = typedCode(err);
          if (code === 'GAME_IN_PROGRESS') {
            resumePending();
            return;
          }
          setError(t(gameErrorKey(code)));
          setPhase('idle');
        },
      },
    );
  }

  const handleFinish = useCallback(
    (performance: unknown) => {
      if (!active) return;
      setError(null);
      setPhase('settling');
      finish.mutate(
        { playId: active.playId, performance },
        {
          onSuccess: (data) => {
            setResult(data as FinishResult);
            setPhase('result');
            void utils.games.list.invalidate();
            void refetchBalances();
          },
          onError: (err) => {
            setError(t(gameErrorKey(typedCode(err))));
            setPhase('idle');
          },
        },
      );
    },
    [active, finish, t, utils, refetchBalances],
  );

  if (list.isPending) {
    return <p className="opacity-60">{t('games.loading')}</p>;
  }

  if (!game) {
    return <p className="opacity-60">{t('games.errors.disabled')}</p>;
  }

  const freeLeft = game.freePlaysRemaining;

  function playAgain() {
    setResult(null);
    setActive(null);
    setPhase('idle');
  }

  if (phase === 'result' && result) {
    const outcomeKey =
      result.outcome === 'won'
        ? 'games.resultWon'
        : result.outcome === 'lost'
          ? 'games.resultLost'
          : result.outcome === 'payout_failed'
            ? 'games.resultPayoutFailed'
            : 'games.resultExpired';
    return (
      <section className="flex flex-col items-center gap-4 rounded-2xl bg-coffee-900 p-6 text-center shadow">
        <p className="text-5xl">{result.outcome === 'won' ? '☕' : result.outcome === 'lost' ? '😔' : '⏰'}</p>
        <h2 className="text-xl font-bold text-coffee-100">
          {result.outcome === 'won'
            ? `${t('games.resultWon')} ${formatAmount(locale, lumensFromStroops(result.prize))} TAK`
            : t(outcomeKey)}
        </h2>
        {result.score !== null && (
          <p className="text-sm opacity-70">
            {t('games.resultScore')}: {result.score}
          </p>
        )}
        <p className="text-sm opacity-70">
          {t('games.freePlaysLeft')}: {result.freePlaysRemaining}
        </p>
        <button
          type="button"
          onClick={playAgain}
          className="rounded-xl bg-coffee-600 px-8 py-3 font-semibold text-coffee-50"
        >
          {t('games.playAgain')}
        </button>
      </section>
    );
  }

  if (phase === 'playing' && active) {
    return (
      <div className="flex flex-col gap-4">
        {active.params.game === 'spin' ? (
          <SpinWheel params={active.params} onFinish={handleFinish} />
        ) : active.params.game === 'tap' ? (
          <TapBean params={active.params} onFinish={handleFinish} />
        ) : (
          <StopClock params={active.params} onFinish={handleFinish} />
        )}
      </div>
    );
  }

  const playDisabled = phase === 'starting' || phase === 'settling' || freeLeft <= 0;

  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-2xl bg-coffee-900 p-6 shadow">
        <h2 className="text-xl font-bold text-coffee-100">{t(game.titleKey)}</h2>
        <p className="mt-1 text-sm opacity-70">{t(game.descriptionKey)}</p>
      </div>
      <div className="flex flex-col gap-3 rounded-2xl bg-coffee-900 p-4 shadow">
        <p className="text-sm opacity-70">
          {freeLeft > 0 ? `${t('games.freePlaysLeft')}: ${freeLeft}` : t('games.freePlaysUsed')}
        </p>
        {freeLeft > 0 ? (
          <button
            type="button"
            onClick={handlePlay}
            disabled={playDisabled}
            className="rounded-xl bg-coffee-600 px-6 py-4 font-semibold text-coffee-50 disabled:opacity-40"
          >
            {phase === 'starting' ? t('games.starting') : t('games.playFree')}
          </button>
        ) : (
          <button type="button" disabled className="rounded-xl bg-coffee-800 px-6 py-4 font-semibold opacity-60">
            {t('games.dailyLimit')}
          </button>
        )}
        <p className="text-center text-xs opacity-60">
          {t('games.winPrize')}: {formatAmount(locale, lumensFromStroops(game.settings.prizeTak))} TAK
        </p>
      </div>
      {error && <p className="rounded-xl bg-red-900/40 p-3 text-sm text-red-200">{error}</p>}
    </section>
  );
}
