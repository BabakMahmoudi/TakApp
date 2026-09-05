import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { Horizon, Keypair } from '@stellar/stellar-sdk/no-axios';
import { Server as SorobanRpc } from '@stellar/stellar-sdk/no-axios/rpc';
import { gamePlays, gameSettings, payments, users } from '@takapp/shared/db';
import type { GamePlay } from '@takapp/shared/db';
import { compareStroops } from '@takapp/shared/money';
import { isLocalHttpUrl } from '@takapp/shared/url';
import { logAdminAction } from '../admin/audit';
import { fetchTakBalance } from '../stellar/horizon';
import { submitTakTransfer } from '../stellar/tak-transfer';
import {
  GAME_KEYS,
  defaultSettings,
  getGameDescriptor,
  isGameKey,
  settle,
  type ClockSettings,
  type GameKey,
  type GameParams,
  type GamePerformance,
  type GameSettings,
  type SpinSettings,
  type TapSettings,
} from '../../lib/games';
import type { TrpcContext } from '../trpc/context';
import type { WorkerEnv } from '../trpc/env';

type Db = TrpcContext['db'];
type GamesEnv = Pick<
  WorkerEnv,
  | 'GAME_ACCOUNT_SECRET'
  | 'HORIZON_URL'
  | 'SOROBAN_RPC_URL'
  | 'NETWORK_PASSPHRASE'
  | 'TAK_CONTRACT_ID'
>;

export type GameErrorCode =
  | 'INVALID_GAME'
  | 'GAME_DISABLED'
  | 'GAME_ACCOUNT_NOT_READY'
  | 'GAME_OUT_OF_FUNDS'
  | 'GAME_IN_PROGRESS'
  | 'PLAY_NOT_FOUND'
  | 'PLAY_EXPIRED'
  | 'PLAY_NOT_PENDING'
  | 'INVALID_PERFORMANCE'
  | 'DAILY_PLAY_LIMIT'
  | 'PAYOUT_FAILED'
  | 'INTERNAL';

export class GameError extends Error {
  constructor(
    message: string,
    public code: GameErrorCode,
  ) {
    super(message);
    this.name = 'GameError';
  }
}

export function toTrpcGameError(error: GameError): TRPCError {
  let code: 'NOT_FOUND' | 'CONFLICT' | 'BAD_REQUEST' | 'INTERNAL_SERVER_ERROR';
  switch (error.code) {
    case 'INVALID_GAME':
    case 'PLAY_NOT_FOUND':
      code = 'NOT_FOUND';
      break;
    case 'GAME_IN_PROGRESS':
      code = 'CONFLICT';
      break;
    case 'INTERNAL':
      code = 'INTERNAL_SERVER_ERROR';
      break;
    default:
      code = 'BAD_REQUEST';
      break;
  }
  // The client reads `error.message` as the typed code and maps it to an i18n
  // key via gameErrorKey(); the human-readable text stays server-side on the
  // GameError. This is the stable contract the lobby/shell rely on to resume a
  // GAME_IN_PROGRESS play via games.history.
  return new TRPCError({ code, message: error.code });
}

export async function withGameErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof GameError) {
      throw toTrpcGameError(error);
    }
    if (error instanceof z.ZodError) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: error.issues[0]?.message ?? 'Invalid input' });
    }
    throw error;
  }
}

const SETTLED_STATUSES = ['won', 'lost', 'payout_failed'];

const stroopsSchema = z.string().regex(/^\d+$/);
const prizeTakSchema = stroopsSchema.refine(
  (value) => compareStroops(value, '10000000') >= 0,
  'prize must be at least 1 TAK',
);

const commonSettingsSchema = z.object({
  enabled: z.boolean(),
  freePlaysPerDay: z.number().int().min(0).max(100),
  paidPlayFee: stroopsSchema,
  maxPaidPlaysPerDay: z.number().int().min(0).max(10000),
  prizeTak: prizeTakSchema,
  completionWindowSeconds: z.number().int().min(10).max(600),
});

const spinSettingsSchema = commonSettingsSchema
  .extend({
    segments: z.number().int().min(2).max(36),
    winSegments: z.number().int().min(1).max(36),
  })
  .superRefine((value, ctx) => {
    if (value.winSegments > value.segments) {
      ctx.addIssue({
        code: 'custom',
        path: ['winSegments'],
        message: 'winSegments must not exceed segments',
      });
    }
  });

const tapSettingsSchema = commonSettingsSchema.extend({
  durationSeconds: z.number().int().min(5).max(120),
  targetTaps: z.number().int().min(5).max(500),
});

const clockSettingsSchema = commonSettingsSchema.extend({
  targetSeconds: z.number().min(3).max(60),
  toleranceMs: z.number().int().min(10).max(1000),
});

export const settingsSchemaByGame: Record<GameKey, z.ZodType<GameSettings>> = {
  spin: spinSettingsSchema,
  tap: tapSettingsSchema,
  clock: clockSettingsSchema,
};

const spinPerformanceSchema = z.object({ ack: z.literal(true) });
const tapPerformanceSchema = z.object({ taps: z.number().int().min(0) });
const clockPerformanceSchema = z.object({ elapsedMs: z.number().int().min(0) });
export function playDayStart(now: Date = new Date()): Date {
  const values: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)) {
    values[part.type] = part.value;
  }
  return new Date(
    Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), 3, 30),
  );
}

function randomInt(maxExclusive: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] ?? 0) % maxExclusive;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseStoredSettings(gameKey: GameKey, settingsText: string): GameSettings | null {
  const raw = safeJson(settingsText);
  if (raw == null) return null;
  const parsed = settingsSchemaByGame[gameKey].safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function getSettings(db: Db, gameKey: GameKey): Promise<GameSettings> {
  const rows = await db.select().from(gameSettings).where(eq(gameSettings.gameKey, gameKey)).limit(1);
  const row = rows[0];
  return (row ? parseStoredSettings(gameKey, row.settings) : null) ?? defaultSettings[gameKey];
}

function getCasinoKeypair(env: GamesEnv): Keypair {
  try {
    return Keypair.fromSecret(env.GAME_ACCOUNT_SECRET);
  } catch {
    throw new GameError('Casino account is not ready', 'GAME_ACCOUNT_NOT_READY');
  }
}

async function readCasinoTakBalance(env: GamesEnv, publicKey: string): Promise<string> {
  const server = new Horizon.Server(env.HORIZON_URL, { allowHttp: isLocalHttpUrl(env.HORIZON_URL) });
  const rpc = new SorobanRpc(env.SOROBAN_RPC_URL, { allowHttp: isLocalHttpUrl(env.SOROBAN_RPC_URL) });
  return fetchTakBalance(server, rpc, publicKey, env.TAK_CONTRACT_ID);
}

async function getCasinoWithBalance(env: GamesEnv): Promise<{ publicKey: string; takBalance: string }> {
  const publicKey = getCasinoKeypair(env).publicKey();
  let takBalance: string;
  try {
    takBalance = await readCasinoTakBalance(env, publicKey);
  } catch {
    throw new GameError('Casino account is not ready', 'GAME_ACCOUNT_NOT_READY');
  }
  return { publicKey, takBalance };
}

function createParams(gameKey: GameKey, settings: GameSettings): GameParams {
  switch (gameKey) {
    case 'spin': {
      const s = settings as SpinSettings;
      return {
        game: 'spin',
        outcomeIndex: randomInt(s.segments),
        segments: s.segments,
        winSegments: s.winSegments,
      };
    }
    case 'tap': {
      const s = settings as TapSettings;
      return {
        game: 'tap',
        durationMs: s.durationSeconds * 1000,
        targetTaps: s.targetTaps,
        startedAtMs: Date.now(),
      };
    }
    case 'clock': {
      const s = settings as ClockSettings;
      return {
        game: 'clock',
        targetMs: Math.round(s.targetSeconds * 1000),
        toleranceMs: s.toleranceMs,
        startedAtMs: Date.now(),
      };
    }
  }
}

export function isValidPerformance(
  gameKey: GameKey,
  performance: unknown,
  params: GameParams,
  completionWindowSeconds: number,
): performance is GamePerformance {
  switch (gameKey) {
    case 'spin':
      return spinPerformanceSchema.safeParse(performance).success;
    case 'tap': {
      const parsed = tapPerformanceSchema.safeParse(performance);
      if (!parsed.success) return false;
      return parsed.data.taps <= 3 * (params as { targetTaps: number }).targetTaps;
    }
    case 'clock': {
      const parsed = clockPerformanceSchema.safeParse(performance);
      if (!parsed.success) return false;
      return parsed.data.elapsedMs <= completionWindowSeconds * 1000;
    }
  }
}

async function countSettledFreePlays(
  db: Db,
  userId: number,
  gameKey: GameKey,
  dayStart: Date,
): Promise<number> {
  const rows = await db
    .select()
    .from(gamePlays)
    .where(
      and(
        eq(gamePlays.userId, userId),
        eq(gamePlays.gameKey, gameKey),
        eq(gamePlays.playType, 'free'),
        inArray(gamePlays.status, SETTLED_STATUSES),
        gte(gamePlays.createdAt, dayStart),
      ),
    );
  return rows.length;
}

async function getFreePlaysRemaining(
  db: Db,
  userId: number,
  gameKey: GameKey,
  settings: GameSettings,
): Promise<number> {
  const settled = await countSettledFreePlays(db, userId, gameKey, playDayStart());
  return Math.max(0, settings.freePlaysPerDay - settled);
}

async function getUserPublicKey(db: Db, userId: number): Promise<string> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new GameError('Winner not found', 'PAYOUT_FAILED');
  return user.stellarPublicKey;
}

async function markPayoutFailed(
  db: Db,
  playId: number,
  performance: GamePerformance,
  score: number | null,
  now: Date,
): Promise<void> {
  await db
    .update(gamePlays)
    .set({ status: 'payout_failed', performance: JSON.stringify(performance), score, settledAt: now })
    .where(eq(gamePlays.id, playId));
}

async function insertPayoutPayment(
  db: Db,
  userId: number,
  winnerPublicKey: string,
  prize: string,
  txHash: string,
  now: Date,
): Promise<void> {
  // Wins surface in the Telegram bot's history intent, which reads `payments`.
  await db
    .insert(payments)
    .values({
      userId,
      recipientPublicKey: winnerPublicKey,
      amount: prize,
      asset: 'TAK',
      txHash,
      status: 'submitted',
      createdAt: now,
    })
    .onConflictDoNothing();
}

export type FinishResult = {
  playId: number;
  outcome: 'won' | 'lost' | 'abandoned' | 'payout_failed';
  prize: string;
  score: number | null;
  freePlaysRemaining: number;
};

async function storedResult(db: Db, play: GamePlay): Promise<FinishResult> {
  const gameKey = isGameKey(play.gameKey) ? play.gameKey : null;
  const settings = gameKey ? await getSettings(db, gameKey) : null;
  return {
    playId: play.id,
    outcome: play.status as FinishResult['outcome'],
    prize: play.status === 'won' ? (play.prize ?? '0') : '0',
    score: play.score,
    freePlaysRemaining:
      gameKey && settings ? await getFreePlaysRemaining(db, play.userId, gameKey, settings) : 0,
  };
}

export async function startGame(db: Db, env: GamesEnv, input: { userId: number; gameKey: string }) {
  if (!isGameKey(input.gameKey)) {
    throw new GameError('Unknown game', 'INVALID_GAME');
  }
  const gameKey = input.gameKey;
  const settings = await getSettings(db, gameKey);
  if (!settings.enabled) {
    throw new GameError('Game is disabled', 'GAME_DISABLED');
  }

  const casino = await getCasinoWithBalance(env);
  if (compareStroops(casino.takBalance, settings.prizeTak) < 0) {
    throw new GameError('Casino cannot cover the prize', 'GAME_OUT_OF_FUNDS');
  }

  const dayStart = playDayStart();
  const pending = await db
    .select()
    .from(gamePlays)
    .where(
      and(
        eq(gamePlays.userId, input.userId),
        eq(gamePlays.gameKey, gameKey),
        eq(gamePlays.status, 'pending'),
      ),
    );

  if (pending.length > 0) {
    const current = pending[0]!;
    const expired =
      current.startedAt.getTime() + settings.completionWindowSeconds * 1000 < Date.now();
    if (!expired) {
      throw new GameError('A play is already in progress', 'GAME_IN_PROGRESS');
    }
    const now = new Date();
    await db
      .update(gamePlays)
      .set({ status: 'abandoned', settledAt: now })
      .where(eq(gamePlays.id, current.id));
  }

  const settledFreeCount = await countSettledFreePlays(db, input.userId, gameKey, dayStart);
  // v1 is free-play only: once the free quota is exhausted there is no paid path.
  if (settledFreeCount >= settings.freePlaysPerDay) {
    throw new GameError('Daily play limit reached', 'DAILY_PLAY_LIMIT');
  }

  const params = createParams(gameKey, settings);
  const now = new Date();
  const [play] = await db
    .insert(gamePlays)
    .values({
      gameKey,
      userId: input.userId,
      playType: 'free',
      status: 'pending',
      params: JSON.stringify(params),
      prize: settings.prizeTak,
      startedAt: now,
      createdAt: now,
    })
    .returning();

  if (!play) {
    throw new GameError('Failed to start play', 'INTERNAL');
  }

  return {
    playId: play.id,
    gameKey,
    playType: 'free' as const,
    params,
    freePlaysRemaining: Math.max(0, settings.freePlaysPerDay - settledFreeCount),
  };
}

export async function finishGame(
  db: Db,
  env: GamesEnv,
  input: { userId: number; playId: number; performance: unknown },
): Promise<FinishResult> {
  const plays = await db
    .select()
    .from(gamePlays)
    .where(and(eq(gamePlays.id, input.playId), eq(gamePlays.userId, input.userId)))
    .limit(1);
  const play = plays[0];
  if (!play) {
    throw new GameError('Play not found', 'PLAY_NOT_FOUND');
  }
  if (play.status !== 'pending') {
    return storedResult(db, play);
  }
  if (!isGameKey(play.gameKey)) {
    throw new GameError('Unknown game', 'INVALID_GAME');
  }
  const gameKey = play.gameKey;
  const settings = await getSettings(db, gameKey);
  const params = safeJson(play.params) as GameParams | null;
  if (!params) {
    throw new GameError('Play parameters are corrupt', 'INTERNAL');
  }

  if (play.startedAt.getTime() + settings.completionWindowSeconds * 1000 < Date.now()) {
    const now = new Date();
    await db.update(gamePlays).set({ status: 'abandoned', settledAt: now }).where(eq(gamePlays.id, play.id));
    return {
      playId: play.id,
      outcome: 'abandoned',
      prize: '0',
      score: null,
      freePlaysRemaining: await getFreePlaysRemaining(db, input.userId, gameKey, settings),
    };
  }

  if (!isValidPerformance(gameKey, input.performance, params, settings.completionWindowSeconds)) {
    throw new GameError('Invalid performance', 'INVALID_PERFORMANCE');
  }
  const performance = input.performance as GamePerformance;

  const result = settle(gameKey, params, performance);
  const now = new Date();

  if (result.outcome === 'lost') {
    await db
      .update(gamePlays)
      .set({
        status: 'lost',
        performance: JSON.stringify(performance),
        score: result.score,
        settledAt: now,
      })
      .where(eq(gamePlays.id, play.id));
    return {
      playId: play.id,
      outcome: 'lost',
      prize: '0',
      score: result.score,
      freePlaysRemaining: await getFreePlaysRemaining(db, input.userId, gameKey, settings),
    };
  }

  const prize = play.prize ?? settings.prizeTak;
  const casinoPublicKey = getCasinoKeypair(env).publicKey();
  let casinoBalance: string;
  try {
    casinoBalance = await readCasinoTakBalance(env, casinoPublicKey);
  } catch {
    await markPayoutFailed(db, play.id, performance, result.score, now);
    throw new GameError('Casino cannot cover the payout', 'PAYOUT_FAILED');
  }
  if (compareStroops(casinoBalance, prize) < 0) {
    await markPayoutFailed(db, play.id, performance, result.score, now);
    throw new GameError('Casino cannot cover the payout', 'PAYOUT_FAILED');
  }

  const winnerPublicKey = await getUserPublicKey(db, input.userId);
  let payout: { txHash: string; envelopeXdr: string };
  try {
    payout = await submitTakTransfer({
      networkPassphrase: env.NETWORK_PASSPHRASE,
      sourceSecret: env.GAME_ACCOUNT_SECRET,
      destination: winnerPublicKey,
      amountStroops: prize,
      takContractId: env.TAK_CONTRACT_ID,
      horizonUrl: env.HORIZON_URL,
      sorobanRpcUrl: env.SOROBAN_RPC_URL,
    });
  } catch {
    await markPayoutFailed(db, play.id, performance, result.score, now);
    throw new GameError('Payout failed', 'PAYOUT_FAILED');
  }

  await db
    .update(gamePlays)
    .set({
      status: 'won',
      performance: JSON.stringify(performance),
      score: result.score,
      payoutTxHash: payout.txHash,
      settledAt: now,
    })
    .where(eq(gamePlays.id, play.id));
  await insertPayoutPayment(db, input.userId, winnerPublicKey, prize, payout.txHash, now);

  return {
    playId: play.id,
    outcome: 'won',
    prize,
    score: result.score,
    freePlaysRemaining: await getFreePlaysRemaining(db, input.userId, gameKey, settings),
  };
}

export async function getGameHistory(db: Db, userId: number, limit = 20) {
  const rows = await db
    .select()
    .from(gamePlays)
    .where(eq(gamePlays.userId, userId))
    .orderBy(desc(gamePlays.createdAt))
    .limit(limit);
  return rows.map((play) => ({
    id: play.id,
    gameKey: play.gameKey,
    playType: play.playType,
    status: play.status,
    params: safeJson(play.params),
    performance: play.performance ? safeJson(play.performance) : null,
    score: play.score,
    prize: play.prize ?? '0',
    startedAt: play.startedAt,
    settledAt: play.settledAt,
  }));
}

export async function listGames(db: Db, userId: number) {
  const dayStart = playDayStart();
  const entries = await Promise.all(
    GAME_KEYS.map(async (gameKey) => {
      const settings = await getSettings(db, gameKey);
      if (!settings.enabled) return null;
      const descriptor = getGameDescriptor(gameKey);
      const settledFreeCount = await countSettledFreePlays(db, userId, gameKey, dayStart);
      return {
        gameKey,
        titleKey: descriptor.titleKey,
        descriptionKey: descriptor.descriptionKey,
        settings,
        freePlaysUsed: settledFreeCount,
        freePlaysRemaining: Math.max(0, settings.freePlaysPerDay - settledFreeCount),
      };
    }),
  );
  return entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

export async function updateSettingsForAdmin(
  db: Db,
  input: { actorUserId: number; gameKey: string; settings: unknown },
): Promise<GameSettings> {
  if (!isGameKey(input.gameKey)) {
    throw new GameError('Unknown game', 'INVALID_GAME');
  }
  const gameKey = input.gameKey;
  const parsed = settingsSchemaByGame[gameKey].safeParse(input.settings);
  if (!parsed.success) {
    throw parsed.error;
  }
  const settings = parsed.data;
  const stored = JSON.stringify(settings);

  const existing = await db
    .select()
    .from(gameSettings)
    .where(eq(gameSettings.gameKey, gameKey))
    .limit(1);
  let rowId = existing[0]?.id ?? null;
  const now = new Date();
  if (existing[0]) {
    await db
      .update(gameSettings)
      .set({ settings: stored, updatedByUserId: input.actorUserId, updatedAt: now })
      .where(eq(gameSettings.id, existing[0].id));
  } else {
    const rows = await db
      .insert(gameSettings)
      .values({ gameKey, settings: stored, updatedByUserId: input.actorUserId, updatedAt: now })
      .returning();
    rowId = rows[0]?.id ?? null;
  }

  await logAdminAction(db, input.actorUserId, 'admin.games.updateSettings', rowId != null ? String(rowId) : undefined);
  return settings;
}

export async function listGamesForAdmin(db: Db, env: GamesEnv) {
  const rows = await db.select().from(gameSettings);
  const storedByKey = new Map(rows.map((row) => [row.gameKey, row]));
  const games = GAME_KEYS.map((gameKey) => {
    const stored = storedByKey.get(gameKey);
    const settings = stored
      ? (parseStoredSettings(gameKey, stored.settings) ?? defaultSettings[gameKey])
      : defaultSettings[gameKey];
    return {
      gameKey,
      titleKey: getGameDescriptor(gameKey).titleKey,
      descriptionKey: getGameDescriptor(gameKey).descriptionKey,
      settings,
      isDefault: !stored,
      updatedAt: stored?.updatedAt ?? null,
    };
  });
  const enabledPrizes = games.filter((game) => game.settings.enabled).map((game) => game.settings.prizeTak);
  const smallestPrize = enabledPrizes.length
    ? enabledPrizes.reduce((min, prize) => (compareStroops(prize, min) < 0 ? prize : min))
    : null;

  let publicKey: string | null = null;
  try {
    publicKey = getCasinoKeypair(env).publicKey();
  } catch {
    publicKey = null;
  }
  let takBalance = '0';
  if (publicKey) {
    try {
      takBalance = await readCasinoTakBalance(env, publicKey);
    } catch {
      takBalance = '0';
    }
  }
  return {
    games,
    casino: publicKey ? { publicKey, takBalance } : null,
    smallestPrize,
  };
}

export async function recentPlaysForAdmin(
  db: Db,
  input: { gameKey?: string; limit?: number },
) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const rows = await db
    .select()
    .from(gamePlays)
    .where(input.gameKey && isGameKey(input.gameKey) ? eq(gamePlays.gameKey, input.gameKey) : undefined)
    .orderBy(desc(gamePlays.createdAt))
    .limit(limit);
  if (rows.length === 0) return [];
  const userIds = [...new Set(rows.map((row) => row.userId))];
  const userRows = await db.select().from(users).where(inArray(users.id, userIds));
  const userById = new Map(userRows.map((user) => [user.id, user]));
  return rows.map((play) => {
    const user = userById.get(play.userId);
    return {
      id: play.id,
      gameKey: play.gameKey,
      userId: play.userId,
      userName: user ? (user.displayName ?? user.email ?? user.stellarPublicKey) : null,
      playType: play.playType,
      status: play.status,
      score: play.score,
      prize: play.prize ?? '0',
      startedAt: play.startedAt,
      settledAt: play.settledAt,
    };
  });
}

export async function retryPayoutForAdmin(
  db: Db,
  env: GamesEnv,
  input: { actorUserId: number; playId: number },
) {
  const plays = await db.select().from(gamePlays).where(eq(gamePlays.id, input.playId)).limit(1);
  const play = plays[0];
  if (!play) {
    throw new GameError('Play not found', 'PLAY_NOT_FOUND');
  }
  if (play.status !== 'payout_failed') {
    throw new GameError('Play is not awaiting payout', 'PLAY_NOT_PENDING');
  }
  if (!isGameKey(play.gameKey)) {
    throw new GameError('Unknown game', 'INVALID_GAME');
  }
  const prize = play.prize ?? '0';
  if (compareStroops(prize, '0') <= 0) {
    throw new GameError('Play has no prize', 'INTERNAL');
  }

  const casinoPublicKey = getCasinoKeypair(env).publicKey();
  let casinoBalance: string;
  try {
    casinoBalance = await readCasinoTakBalance(env, casinoPublicKey);
  } catch {
    throw new GameError('Casino account is not ready', 'GAME_ACCOUNT_NOT_READY');
  }
  if (compareStroops(casinoBalance, prize) < 0) {
    throw new GameError('Casino cannot cover the payout', 'PAYOUT_FAILED');
  }

  const winnerPublicKey = await getUserPublicKey(db, play.userId);
  let payout: { txHash: string; envelopeXdr: string };
  try {
    payout = await submitTakTransfer({
      networkPassphrase: env.NETWORK_PASSPHRASE,
      sourceSecret: env.GAME_ACCOUNT_SECRET,
      destination: winnerPublicKey,
      amountStroops: prize,
      takContractId: env.TAK_CONTRACT_ID,
      horizonUrl: env.HORIZON_URL,
      sorobanRpcUrl: env.SOROBAN_RPC_URL,
    });
  } catch {
    throw new GameError('Payout failed', 'PAYOUT_FAILED');
  }

  const now = new Date();
  await db
    .update(gamePlays)
    .set({ status: 'won', payoutTxHash: payout.txHash, settledAt: now })
    .where(eq(gamePlays.id, play.id));
  await insertPayoutPayment(db, play.userId, winnerPublicKey, prize, payout.txHash, now);
  await logAdminAction(db, input.actorUserId, 'admin.games.retryPayout', String(play.id));

  return { playId: play.id, outcome: 'won' as const, prize, score: play.score };
}

export async function getCasinoOverview(env: GamesEnv) {
  const publicKey = getCasinoKeypair(env).publicKey();
  const server = new Horizon.Server(env.HORIZON_URL, { allowHttp: isLocalHttpUrl(env.HORIZON_URL) });
  const rpc = new SorobanRpc(env.SOROBAN_RPC_URL, { allowHttp: isLocalHttpUrl(env.SOROBAN_RPC_URL) });
  const takBalance = await fetchTakBalance(server, rpc, publicKey, env.TAK_CONTRACT_ID);
  let xlmBalance = '0';
  try {
    const account = await server.loadAccount(publicKey);
    const native = account.balances.find((balance) => balance.asset_type === 'native');
    xlmBalance = native ? native.balance : '0';
  } catch {
    xlmBalance = '0';
  }
  return { publicKey, takBalance, xlmBalance };
}

export async function withdrawFromCasino(
  db: Db,
  env: GamesEnv,
  input: { actorUserId: number; amount: string; destination: string },
) {
  const publicKey = getCasinoKeypair(env).publicKey();
  if (!/^G[A-Z2-7]{55}$/.test(input.destination)) {
    throw new GameError('Invalid destination address', 'INVALID_GAME');
  }
  if (input.destination === publicKey) {
    throw new GameError('Cannot withdraw to the casino account itself', 'INVALID_GAME');
  }
  if (compareStroops(input.amount, '0') <= 0) {
    throw new GameError('Amount must be positive', 'INVALID_GAME');
  }

  const balance = await readCasinoTakBalance(env, publicKey);
  if (compareStroops(balance, input.amount) < 0) {
    throw new GameError('Casino cannot cover the withdrawal', 'GAME_OUT_OF_FUNDS');
  }

  let payout: { txHash: string; envelopeXdr: string };
  try {
    payout = await submitTakTransfer({
      networkPassphrase: env.NETWORK_PASSPHRASE,
      sourceSecret: env.GAME_ACCOUNT_SECRET,
      destination: input.destination,
      amountStroops: input.amount,
      takContractId: env.TAK_CONTRACT_ID,
      horizonUrl: env.HORIZON_URL,
      sorobanRpcUrl: env.SOROBAN_RPC_URL,
    });
  } catch {
    throw new GameError('Withdrawal failed', 'PAYOUT_FAILED');
  }

  await logAdminAction(db, input.actorUserId, 'admin.casino.withdraw', input.destination);
  return { txHash: payout.txHash, amount: input.amount, destination: input.destination };
}
