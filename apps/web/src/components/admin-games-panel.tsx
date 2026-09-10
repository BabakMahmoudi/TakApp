'use client';

import { useEffect, useState } from 'react';
import { compareStroops, lumensFromStroops, stroopsFromLumens } from '@takapp/shared/money';
import { settingsFields, type GameKey, type SettingField } from '../lib/games';
import { formatAmount, useI18n } from '../lib/i18n';
import type { Messages } from '../lib/i18n/messages';
import { trpc } from '../lib/trpc/trpc';

const inputClass = 'rounded-md border border-coffee-700 bg-coffee-950 px-3 py-2 text-coffee-100';
const buttonClass = 'rounded-md bg-coffee-600 px-3 py-1.5 text-sm font-medium text-coffee-50 disabled:opacity-50';

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type AdminGame = {
  gameKey: GameKey;
  titleKey: keyof Messages;
  descriptionKey: keyof Messages;
  settings: Record<string, unknown>;
  isDefault: boolean;
  updatedAt: Date | null;
};

function toForm(gameKey: GameKey, settings: Record<string, unknown>): Record<string, string | boolean> {
  const form: Record<string, string | boolean> = {};
  for (const field of settingsFields[gameKey]) {
    const value = settings[field.key];
    if (field.type === 'toggle') {
      form[field.key] = value === true;
    } else if (field.type === 'tak') {
      form[field.key] = lumensFromStroops(String(value ?? '0'));
    } else {
      form[field.key] = String(value ?? '');
    }
  }
  return form;
}

function buildSettings(gameKey: GameKey, form: Record<string, string | boolean>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of settingsFields[gameKey]) {
    const value = form[field.key];
    if (field.type === 'toggle') {
      out[field.key] = value === true;
    } else if (field.type === 'tak') {
      out[field.key] = stroopsFromLumens(String(value));
    } else {
      out[field.key] = Number(value);
    }
  }
  return out;
}

function GameSettingsForm({ game, onSaved }: { game: AdminGame; onSaved: () => void }) {
  const { t } = useI18n();
  const update = trpc.admin.games.updateSettings.useMutation();
  const [form, setForm] = useState<Record<string, string | boolean>>(() =>
    toForm(game.gameKey, game.settings),
  );
  const [error, setError] = useState<string | null>(null);

  function renderField(field: SettingField) {
    const key = `admin.gameField.${game.gameKey}.${field.key}`;
    if (field.type === 'toggle') {
      return (
        <label key={key} className="flex items-center gap-2 text-xs text-coffee-300">
          <input
            type="checkbox"
            checked={form[field.key] === true}
            onChange={(event) => setForm({ ...form, [field.key]: event.target.checked })}
          />
          {t(field.labelKey)}
        </label>
      );
    }
    if (field.type === 'tak') {
      return (
        <label key={key} className="flex items-center gap-2 text-xs text-coffee-300">
          <span className="w-40">{t(field.labelKey)}</span>
          <input
            value={String(form[field.key] ?? '')}
            onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
            inputMode="decimal"
            className={`${inputClass} flex-1`}
          />
        </label>
      );
    }
    return (
      <label key={key} className="flex items-center gap-2 text-xs text-coffee-300">
        <span className="w-40">
          {t(field.labelKey)}
          {field.unitKey ? ` (${t(field.unitKey)})` : ''}
        </span>
        <input
          value={String(form[field.key] ?? '')}
          onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
          inputMode="decimal"
          className={`${inputClass} flex-1`}
        />
      </label>
    );
  }

  async function save() {
    setError(null);
    try {
      await update.mutateAsync({ gameKey: game.gameKey, settings: buildSettings(game.gameKey, form) });
      onSaved();
    } catch (cause) {
      setError(message(cause));
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md bg-coffee-950 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-coffee-100">
          {t(game.titleKey)} {game.isDefault ? t('admin.games.default') : ''}
        </p>
        <button onClick={() => void save()} disabled={update.isPending} className={buttonClass}>
          {update.isPending ? t('admin.saving') : t('admin.games.saveSettings')}
        </button>
      </div>
      <div className="flex flex-col gap-1.5">{settingsFields[game.gameKey].map(renderField)}</div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

export function GamesTab({ onAuthError }: { onAuthError: (error: unknown) => void }) {
  const { t, locale } = useI18n();
  const utils = trpc.useUtils();
  const list = trpc.admin.games.list.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const recent = trpc.admin.games.recentPlays.useQuery({ limit: 20 }, { retry: false, refetchOnWindowFocus: false });
  const retry = trpc.admin.games.retryPayout.useMutation();

  useEffect(() => {
    if (list.error) onAuthError(list.error);
  }, [list.error, onAuthError]);

  async function retryPayout(playId: number) {
    try {
      await retry.mutateAsync({ playId });
      await utils.admin.games.list.invalidate();
      await utils.admin.games.recentPlays.invalidate();
    } catch (cause) {
      onAuthError(cause);
    }
  }

  if (list.isPending) return <p className="text-sm text-coffee-300">{t('games.loading')}</p>;

  const data = list.data;
  const casino = data?.casino ?? null;
  const smallestPrize = data?.smallestPrize ?? null;
  const fundsWarning =
    casino !== null && smallestPrize !== null && compareStroops(casino.takBalance, smallestPrize) < 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => {
            void list.refetch();
            void recent.refetch();
          }}
          disabled={list.isFetching || recent.isFetching}
          className="rounded-md border border-coffee-700 px-3 py-1.5 text-xs text-coffee-200 disabled:opacity-50"
        >
          {list.isFetching || recent.isFetching ? '…' : t('admin.refresh')}
        </button>
      </div>
      {fundsWarning && (
        <p className="rounded-md bg-red-900/40 p-2 text-xs text-red-200">
          {t('admin.games.fundsWarning')} ({formatAmount(locale, lumensFromStroops(casino!.takBalance))} /{' '}
          {formatAmount(locale, lumensFromStroops(smallestPrize!))} TAK)
        </p>
      )}
      {data?.games.map((game) => (
        <GameSettingsForm
          key={game.gameKey}
          game={game as AdminGame}
          onSaved={() => void utils.admin.games.list.invalidate()}
        />
      ))}

      <p className="text-sm font-medium text-coffee-100">{t('admin.games.recentPlays')}</p>
      <ul className="divide-y divide-coffee-800">
        {recent.data?.map((play) => (
          <li key={play.id} className="flex items-center justify-between gap-2 py-2 text-xs text-coffee-300">
            <div>
              <p className="text-coffee-100">
                {play.userName ?? `#${play.userId}`} · {play.gameKey} · {play.status}
              </p>
              <p className="text-coffee-400">
                {t('admin.games.prize')}: {formatAmount(locale, lumensFromStroops(play.prize))} TAK
                {play.score !== null ? ` · ${t('admin.games.score')}: ${play.score}` : ''}
              </p>
            </div>
            {play.status === 'payout_failed' && (
              <button
                onClick={() => void retryPayout(play.id)}
                disabled={retry.isPending}
                className="rounded-md border border-coffee-700 px-2 py-1 text-xs text-coffee-200 disabled:opacity-50"
              >
                {t('admin.games.retryPayout')}
              </button>
            )}
          </li>
        ))}
        {(recent.data?.length ?? 0) === 0 && (
          <li className="py-2 text-sm text-coffee-300">{t('admin.games.noPlays')}</li>
        )}
      </ul>
    </div>
  );
}

export function CasinoTab({ onAuthError }: { onAuthError: (error: unknown) => void }) {
  const { t, locale } = useI18n();
  const utils = trpc.useUtils();
  const overview = trpc.admin.casino.get.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const withdraw = trpc.admin.casino.withdraw.useMutation();
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (overview.error) onAuthError(overview.error);
  }, [overview.error, onAuthError]);

  async function doWithdraw() {
    setError(null);
    setStatus(null);
    try {
      const result = await withdraw.mutateAsync({ amount: stroopsFromLumens(amount), destination });
      setStatus(`${t('admin.casino.withdrawn')} ${result.txHash.slice(0, 16)}…`);
      setAmount('');
      setDestination('');
      await utils.admin.casino.get.invalidate();
    } catch (cause) {
      onAuthError(cause);
      setError(message(cause));
    }
  }

  if (overview.isPending) return <p className="text-sm text-coffee-300">{t('games.loading')}</p>;

  if (!overview.data) {
    return <p className="text-sm text-coffee-300">{t('admin.casino.notReady')}</p>;
  }

  const casino = overview.data;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => void overview.refetch()}
          disabled={overview.isFetching}
          className="rounded-md border border-coffee-700 px-3 py-1.5 text-xs text-coffee-200 disabled:opacity-50"
        >
          {overview.isFetching ? '…' : t('admin.refresh')}
        </button>
      </div>
      <div className="rounded-md bg-coffee-950 p-3 text-xs text-coffee-300">
        <p className="text-coffee-100">{t('admin.casino.publicKey')}</p>
        <p className="break-all font-mono text-[10px] text-coffee-400">{casino.publicKey}</p>
        <p className="mt-2">
          {t('admin.casino.takBalance')}: {formatAmount(locale, lumensFromStroops(casino.takBalance))} TAK
        </p>
        <p>
          {t('admin.casino.xlmBalance')}: {formatAmount(locale, casino.xlmBalance)} XLM
        </p>
        <p className="mt-2 opacity-70">{t('admin.casino.fundHint')}</p>
      </div>
      <div className="flex flex-col gap-2">
        <input
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          placeholder={t('admin.casino.destination')}
          className={inputClass}
        />
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          placeholder={t('admin.casino.amount')}
          className={inputClass}
        />
        <button
          onClick={() => void doWithdraw()}
          disabled={withdraw.isPending || amount.length === 0 || destination.length === 0}
          className={buttonClass}
        >
          {withdraw.isPending ? t('admin.saving') : t('admin.casino.withdraw')}
        </button>
      </div>
      {status && <p className="text-xs text-green-400">{status}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
