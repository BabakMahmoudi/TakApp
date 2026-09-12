'use client';

import { useEffect, useRef, useState } from 'react';
import type { BlackjackCard, BlackjackParams } from '../../lib/games';
import { useI18n } from '../../lib/i18n';
import type { Messages } from '../../lib/i18n/messages';
import { trpc } from '../../lib/trpc/trpc';

type FinishResult = {
  playId: number;
  outcome: 'won' | 'lost' | 'abandoned' | 'payout_failed';
  prize: string;
  score: number | null;
};

const SUIT_GLYPHS: Record<BlackjackCard['suit'], string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

function isRed(card: BlackjackCard): boolean {
  return card.suit === 'hearts' || card.suit === 'diamonds';
}

function dealAnimation(index: number) {
  return {
    animation: 'bj-deal-in 340ms cubic-bezier(0.2, 0.8, 0.3, 1) both',
    animationDelay: `${index * 110}ms`,
  };
}

function PlayingCard({
  card,
  faceDown,
  index,
  flip,
}: {
  card?: BlackjackCard;
  faceDown?: boolean;
  index: number;
  flip?: boolean;
}) {
  if (faceDown || !card) {
    return (
      <div
        className="relative flex h-24 w-16 shrink-0 flex-col rounded-lg border border-coffee-500 bg-coffee-700 shadow-md sm:h-28 sm:w-20"
        style={dealAnimation(index)}
      >
        <div className="absolute inset-1 rounded-md border border-coffee-400/40" />
        <div className="flex h-full items-center justify-center text-2xl opacity-40">☕</div>
      </div>
    );
  }
  const red = isRed(card);
  return (
    <div
      className="relative flex h-24 w-16 shrink-0 select-none flex-col rounded-lg border border-coffee-300 bg-coffee-50 p-1.5 shadow-md sm:h-28 sm:w-20 sm:p-2"
      style={flip ? { animation: 'bj-flip-in 480ms ease-out both' } : dealAnimation(index)}
    >
      <span
        className={`text-sm font-bold leading-none sm:text-base ${red ? 'text-red-600' : 'text-coffee-900'}`}
      >
        {card.rank}
      </span>
      <span
        className={`text-xs leading-none sm:text-sm ${red ? 'text-red-600' : 'text-coffee-900'}`}
      >
        {SUIT_GLYPHS[card.suit]}
      </span>
      <span
        className={`mt-auto self-center text-2xl sm:text-3xl ${red ? 'text-red-600' : 'text-coffee-900'}`}
      >
        {SUIT_GLYPHS[card.suit]}
      </span>
    </div>
  );
}

function resultLabel(visible: BlackjackParams): keyof Messages {
  const playerBust = visible.playerTotal > 21;
  if (visible.outcome === 'won') {
    const natural = visible.playerCards.length === 2 && visible.playerTotal === 21;
    return natural ? 'games.blackjack.blackjack' : 'games.resultWon';
  }
  if (playerBust) return 'games.blackjack.bust';
  if (visible.dealerTotal !== null && visible.dealerTotal === visible.playerTotal) {
    return 'games.blackjack.push';
  }
  return 'games.resultLost';
}

export function BlackjackTable({
  playId,
  params,
  onSettled,
  onError,
}: {
  playId: number;
  params: BlackjackParams;
  onSettled: (result: FinishResult) => void;
  onError: (error: unknown) => void;
}) {
  const { t } = useI18n();
  const action = trpc.games.blackjack.action.useMutation();
  const [visible, setVisible] = useState<BlackjackParams>(params);
  const settleTimer = useRef<number | null>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    return () => {
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    };
  }, []);

  function handleAction(next: 'hit' | 'stand') {
    if (settledRef.current || action.isPending) return;
    action.mutate(
      { playId, action: next },
      {
        onSuccess: (data) => {
          setVisible(data.params);
          if (data.result) {
            settledRef.current = true;
            settleTimer.current = window.setTimeout(() => {
              onSettled(data.result as FinishResult);
            }, 1500);
          }
        },
        onError,
      },
    );
  }

  const settled = visible.phase === 'settled';
  const dealerHole = visible.dealerCards[1];

  return (
    <div className="flex flex-col items-center gap-5">
      <style>{`
        @keyframes bj-deal-in {
          0% { opacity: 0; transform: translateY(-22px) rotate(-12deg) scale(0.85); }
          100% { opacity: 1; transform: translateY(0) rotate(0) scale(1); }
        }
        @keyframes bj-flip-in {
          0% { opacity: 0.4; transform: perspective(600px) rotateY(90deg); }
          100% { opacity: 1; transform: perspective(600px) rotateY(0deg); }
        }
      `}</style>

      <section className="w-full rounded-2xl bg-coffee-900 p-4">
        <div className="flex items-center justify-between text-sm opacity-70">
          <span>{t('games.blackjack.dealer')}</span>
          <span className="tabular-nums" dir="ltr">
            {settled && visible.dealerTotal !== null ? visible.dealerTotal : '—'}
          </span>
        </div>
        <div className="mt-2 flex min-h-[7rem] items-center gap-2 overflow-x-auto pb-1 sm:min-h-[8rem]">
          <PlayingCard card={visible.dealerCards[0]} index={0} />
          <PlayingCard
            key={settled ? 'dealer-hole-up' : 'dealer-hole-down'}
            card={dealerHole}
            faceDown={!settled}
            index={1}
            flip={settled}
          />
          {visible.dealerCards.slice(2).map((card, i) => (
            <PlayingCard key={`dealer-${i + 2}`} card={card} index={i + 2} />
          ))}
        </div>
      </section>

      <section className="w-full rounded-2xl bg-coffee-900 p-4">
        <div className="flex items-center justify-between text-sm opacity-70">
          <span>{t('games.blackjack.player')}</span>
          <span className="tabular-nums" dir="ltr">
            {visible.playerTotal}
          </span>
        </div>
        <div className="mt-2 flex min-h-[7rem] items-center gap-2 overflow-x-auto pb-1 sm:min-h-[8rem]">
          {visible.playerCards.map((card, i) => (
            <PlayingCard key={`player-${i}`} card={card} index={i} />
          ))}
        </div>
      </section>

      {settled ? (
        <p className="text-lg font-bold text-coffee-100">{t(resultLabel(visible))}</p>
      ) : (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => handleAction('hit')}
            disabled={action.isPending}
            className="rounded-xl bg-coffee-600 px-8 py-3 font-semibold text-coffee-50 disabled:opacity-40"
          >
            {t('games.blackjack.hit')}
          </button>
          <button
            type="button"
            onClick={() => handleAction('stand')}
            disabled={action.isPending}
            className="rounded-xl border border-coffee-500 px-8 py-3 font-semibold text-coffee-100 disabled:opacity-40"
          >
            {t('games.blackjack.stand')}
          </button>
        </div>
      )}
    </div>
  );
}
