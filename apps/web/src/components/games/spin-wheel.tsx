'use client';

import { useEffect, useRef, useState } from 'react';
import type { SpinParams } from '../../lib/games';
import { useI18n } from '../../lib/i18n';

export function SpinWheel({
  params,
  onFinish,
}: {
  params: SpinParams;
  onFinish: (performance: { ack: true }) => void;
}) {
  const { t } = useI18n();
  const [rotation, setRotation] = useState(0);
  const startedRef = useRef(false);
  const doneRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const segDeg = 360 / params.segments;
    const final = 360 * 5 + (360 - (params.outcomeIndex + 0.5) * segDeg);
    const timer = window.setTimeout(() => {
      if (doneRef.current) return;
      doneRef.current = true;
      onFinish({ ack: true });
    }, 4200);
    const frame = window.requestAnimationFrame(() => setRotation(final));
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
    };
  }, [params, onFinish]);

  const segDeg = 360 / params.segments;
  const stops = Array.from({ length: params.segments }, (_, i) => {
    const win = i < params.winSegments;
    const color = win ? '#16a34a' : '#a1a1aa';
    return `${color} ${i * segDeg}deg ${(i + 1) * segDeg}deg`;
  }).join(', ');

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative h-64 w-64">
        <div
          className="pointer-events-none absolute -top-1 left-1/2 z-10 h-0 w-0 -translate-x-1/2"
          style={{
            borderLeft: '8px solid transparent',
            borderRight: '8px solid transparent',
            borderTop: '16px solid #e7e5e4',
          }}
        />
        <div
          className="h-full w-full rounded-full shadow-lg"
          style={{
            background: `conic-gradient(${stops})`,
            transform: `rotate(${rotation}deg)`,
            transition: 'transform 4000ms cubic-bezier(0.15, 0.85, 0.25, 1)',
          }}
        />
      </div>
      <p className="text-sm opacity-70">{t('games.spin.spinning')}</p>
      <p className="text-xs opacity-60">
        {t('games.spin.winOdds')}: {params.winSegments} / {params.segments}
      </p>
    </div>
  );
}
