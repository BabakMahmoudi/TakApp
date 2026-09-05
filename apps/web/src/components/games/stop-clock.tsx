'use client';

import { useEffect, useRef, useState } from 'react';
import type { ClockParams } from '../../lib/games';
import { useI18n } from '../../lib/i18n';

export function StopClock({
  params,
  onFinish,
}: {
  params: ClockParams;
  onFinish: (performance: { elapsedMs: number }) => void;
}) {
  const { t } = useI18n();
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef(0);
  const finishedRef = useRef(false);

  useEffect(() => {
    startRef.current = performance.now();
    const interval = window.setInterval(() => {
      setElapsedMs(Math.round(performance.now() - startRef.current));
    }, 16);
    return () => window.clearInterval(interval);
  }, []);

  function stop() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish({ elapsedMs: Math.round(performance.now() - startRef.current) });
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <p className="text-sm opacity-70">
        {t('games.clock.target')}: {(params.targetMs / 1000).toFixed(1)}s
      </p>
      <p className="text-6xl font-bold tabular-nums text-coffee-100" dir="ltr">
        {(elapsedMs / 1000).toFixed(2)}
      </p>
      <button
        type="button"
        onClick={stop}
        className="rounded-2xl bg-coffee-600 px-12 py-4 text-lg font-semibold text-coffee-50 transition-transform active:scale-95"
      >
        {t('games.clock.stop')}
      </button>
      <p className="text-xs opacity-60">
        {t('games.clock.tolerance')}: {(params.toleranceMs / 1000).toFixed(1)}s
      </p>
    </div>
  );
}
