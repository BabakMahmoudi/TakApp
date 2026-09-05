'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TapParams } from '../../lib/games';
import { useI18n } from '../../lib/i18n';

type Bean = { id: number; x: number; y: number };

function randomBean(id: number): Bean {
  return { id, x: 12 + Math.random() * 76, y: 15 + Math.random() * 70 };
}

export function TapBean({
  params,
  onFinish,
}: {
  params: TapParams;
  onFinish: (performance: { taps: number }) => void;
}) {
  const { t } = useI18n();
  const [taps, setTaps] = useState(0);
  const [remainingMs, setRemainingMs] = useState(params.durationMs);
  const [bean, setBean] = useState<Bean>(() => randomBean(0));
  const tapsRef = useRef(0);
  const finishedRef = useRef(false);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish({ taps: tapsRef.current });
  }, [onFinish]);

  useEffect(() => {
    const started = Date.now();
    const interval = window.setInterval(() => {
      const remaining = params.durationMs - (Date.now() - started);
      if (remaining <= 0) {
        window.clearInterval(interval);
        setRemainingMs(0);
        finish();
      } else {
        setRemainingMs(remaining);
      }
    }, 100);
    return () => window.clearInterval(interval);
  }, [params.durationMs, finish]);

  function tapBean() {
    tapsRef.current += 1;
    setTaps(tapsRef.current);
    setBean((prev) => randomBean(prev.id + 1));
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex w-full items-center justify-between text-sm opacity-70">
        <span>
          {t('games.tap.taps')}: {taps}
        </span>
        <span>
          {t('games.tap.target')}: {params.targetTaps}
        </span>
        <span>{Math.ceil(remainingMs / 1000)}s</span>
      </div>
      <div className="relative h-80 w-full touch-none select-none overflow-hidden rounded-2xl bg-coffee-800">
        <button
          type="button"
          onPointerDown={tapBean}
          aria-label={t('games.tap.bean')}
          className="absolute h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-600 text-3xl shadow-md transition-transform active:scale-90"
          style={{ left: `${bean.x}%`, top: `${bean.y}%` }}
        >
          ☕
        </button>
      </div>
      <p className="text-xs opacity-60">{t('games.tap.hint')}</p>
    </div>
  );
}
