import { and, desc, eq, inArray } from 'drizzle-orm';
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
  type BlackjackAction,
  type BlackjackParams,
  type ClockSettings,
  type GameKey,
  type GameParams,
  type GamePerformance,
  type GameSettings,
  type SpinSettings,
  type TapSettings,
} from '../../lib/games';
import {
  applyHit,
  applyStand,
  blackjackOutcome,
  deal,
  isBust,
  newShoe,
  visibleState,
  type BlackjackHiddenState,
} from './blackjack';
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
  | 'FEE_REQUIRED'
  | 'FEE_ALREADY_USED'
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

const stroopsSchema = z.string().regex(/^\d+$/);
const prizeTakSchema = stroopsSchema.refine(
  (value) => compareStroops(value, '10000000') >= 0,
  'prize must be at least 1 TAK',
);

const commonSettingsSchema = z.object({
  enabled: z.boolean(),
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

const blackjackSettingsSchema = commonSettingsSchema;

export const settingsSchemaByGame: Record<GameKey, z.ZodType<GameSettings>> = {
  spin: spinSettingsSchema,
  tap: tapSettingsSchema,
  clock: clockSettingsSchema,
  blackjack: blackjackSettingsSchema,
};

const spinPerformanceSchema = z.object({ ack: z.literal(true) });
const tapPerformanceSchema = z.object({ taps: z.number().int().min(0) });
const clockPerformanceSchema = z.object({ elapsedMs: z.number().int().min(0) });

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
    case 'blackjack':
      throw new GameError('blackjack uses a dedicated deal path', 'INTERNAL');
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
    case 'blackjack':
      return false;
  }
}

async function getUserPublicKey(db: Db, userId: number): Promise<string> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new GameError('Winner not found', 'PAYOUT_FAILED');
  return user.stellarPublicKey;
}

async function markPayoutFailed(
  db: Db,
  playId: number,
  performance: GamePerformance | null,
  score: number | null,
  now: Date,
): Promise<void> {
  await db
    .update(gamePlays)
    .set({
      status: 'payout_failed',
      performance: performance ? JSON.stringify(performance) : null,
      score,
      settledAt: now,
    })
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
};

async function storedResult(play: GamePlay): Promise<FinishResult> {
  return {
    playId: play.id,
    outcome: play.status as FinishResult['outcome'],
    prize: play.status === 'won' ? (play.prize ?? '0') : '0',
    score: play.score,
  };
}

async function payOutWin(
  db: Db,
  env: GamesEnv,
  play: GamePlay,
  userId: number,
  prize: string,
  performance: GamePerformance | null,
  score: number | null,
): Promise<FinishResult> {
  const now = new Date();
  const casinoPublicKey = getCasinoKeypair(env).publicKey();
  let casinoBalance: string;
  try {
    casinoBalance = await readCasinoTakBalance(env, casinoPublicKey);
  } catch {
    await markPayoutFailed(db, play.id, performance, score, now);
    throw new GameError('Casino cannot cover the payout', 'PAYOUT_FAILED');
  }
  if (compareStroops(casinoBalance, prize) < 0) {
    await markPayoutFailed(db, play.id, performance, score, now);
    throw new GameError('Casino cannot cover the payout', 'PAYOUT_FAILED');
  }

  const winnerPublicKey = await getUserPublicKey(db, userId);
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
    await markPayoutFailed(db, play.id, performance, score, now);
    throw new GameError('Payout failed', 'PAYOUT_FAILED');
  }

  await db
    .update(gamePlays)
    .set({
      status: 'won',
      performance: performance ? JSON.stringify(performance) : null,
      score,
      payoutTxHash: payout.txHash,
      settledAt: now,
    })
    .where(eq(gamePlays.id, play.id));
  await insertPayoutPayment(db, userId, winnerPublicKey, prize, payout.txHash, now);

  return {
    playId: play.id,
    outcome: 'won',
    prize,
    score,
  };
}

export async function startGame(
  db: Db,
  env: GamesEnv,
  input: { userId: number; gameKey: string; feeTxHash: string },
) {
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

  if (!/^[0-9a-fA-F]{64}$/.test(input.feeTxHash)) {
    throw new GameError('A payment is required to play', 'FEE_REQUIRED');
  }

  const now = new Date();
  const [fee] = await db
    .insert(payments)
    .values({
      userId: input.userId,
      recipientPublicKey: casino.publicKey,
      amount: settings.paidPlayFee,
      asset: 'TAK',
      txHash: input.feeTxHash,
      status: 'submitted',
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (!fee) {
    throw new GameError('This payment was already used', 'FEE_ALREADY_USED');
  }

  let params: GameParams;
  let hiddenState: string | null = null;
  if (gameKey === 'blackjack') {
    const hidden = deal(newShoe());
    const visible = visibleState(hidden, { settled: false, outcome: null });
    params = { game: 'blackjack', ...visible };
    hiddenState = JSON.stringify(hidden);
  } else {
    params = createParams(gameKey, settings);
  }

  const [play] = await db
    .insert(gamePlays)
    .values({
      gameKey,
      userId: input.userId,
      playType: 'paid',
      status: 'pending',
      params: JSON.stringify(params),
      hiddenState,
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
    playType: 'paid' as const,
    params,
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
    return storedResult(play);
  }
  if (!isGameKey(play.gameKey)) {
    throw new GameError('Unknown game', 'INVALID_GAME');
  }
  const gameKey = play.gameKey;
  if (gameKey === 'blackjack') {
    throw new GameError('Blackjack is settled via the action state machine', 'INVALID_GAME');
  }
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
    };
  }

  const prize = play.prize ?? settings.prizeTak;
  return payOutWin(db, env, play, input.userId, prize, performance, result.score);
}

export type BlackjackActionResponse = {
  playId: number;
  phase: 'player_turn' | 'settled';
  params: BlackjackParams;
  result: FinishResult | null;
};

function parseHiddenState(text: string | null): BlackjackHiddenState | null {
  if (!text) return null;
  const raw = safeJson(text);
  if (raw == null || typeof raw !== 'object') return null;
  const state = raw as { deck?: unknown; playerCards?: unknown; dealerCards?: unknown };
  if (!Array.isArray(state.deck) || !Array.isArray(state.playerCards) || !Array.isArray(state.dealerCards)) {
    return null;
  }
  return state as unknown as BlackjackHiddenState;
}

function blackjackParams(hidden: BlackjackHiddenState, settled: boolean, outcome: 'won' | 'lost' | null): BlackjackParams {
  return { game: 'blackjack', ...visibleState(hidden, { settled, outcome }) };
}

export async function blackjackAction(
  db: Db,
  env: GamesEnv,
  input: { userId: number; playId: number; action: BlackjackAction },
): Promise<BlackjackActionResponse> {
  const plays = await db
    .select()
    .from(gamePlays)
    .where(and(eq(gamePlays.id, input.playId), eq(gamePlays.userId, input.userId)))
    .limit(1);
  const play = plays[0];
  if (!play) {
    throw new GameError('Play not found', 'PLAY_NOT_FOUND');
  }
  if (play.gameKey !== 'blackjack') {
    throw new GameError('Play is not blackjack', 'INVALID_GAME');
  }

  if (play.status !== 'pending') {
    const params = safeJson(play.params) as BlackjackParams | null;
    if (!params || params.game !== 'blackjack') {
      throw new GameError('Play parameters are corrupt', 'INTERNAL');
    }
    return { playId: play.id, phase: 'settled', params, result: await storedResult(play) };
  }

  const settings = await getSettings(db, 'blackjack');
  const hidden = parseHiddenState(play.hiddenState);
  if (!hidden) {
    throw new GameError('Play state is corrupt', 'INTERNAL');
  }

  const now = new Date();
  if (play.startedAt.getTime() + settings.completionWindowSeconds * 1000 < Date.now()) {
    const params = blackjackParams(hidden, true, null);
    await db
      .update(gamePlays)
      .set({ status: 'abandoned', params: JSON.stringify(params), settledAt: now })
      .where(eq(gamePlays.id, play.id));
    return {
      playId: play.id,
      phase: 'settled',
      params,
      result: { playId: play.id, outcome: 'abandoned', prize: '0', score: null },
    };
  }

  if (input.action === 'hit') {
    const next = applyHit(hidden);
    if (isBust(next.playerCards)) {
      const params = blackjackParams(next, true, 'lost');
      await db
        .update(gamePlays)
        .set({
          status: 'lost',
          params: JSON.stringify(params),
          hiddenState: JSON.stringify(next),
          score: null,
          settledAt: now,
        })
        .where(eq(gamePlays.id, play.id));
      return {
        playId: play.id,
        phase: 'settled',
        params,
        result: { playId: play.id, outcome: 'lost', prize: '0', score: null },
      };
    }

    const params = blackjackParams(next, false, null);
    await db
      .update(gamePlays)
      .set({ params: JSON.stringify(params), hiddenState: JSON.stringify(next) })
      .where(eq(gamePlays.id, play.id));
    return { playId: play.id, phase: 'player_turn', params, result: null };
  }

  const next = applyStand(hidden);
  const outcome = blackjackOutcome(next.playerCards, next.dealerCards);
  const resolved: 'won' | 'lost' = outcome === 'win' ? 'won' : 'lost';
  const params = blackjackParams(next, true, resolved);

  if (resolved === 'lost') {
    await db
      .update(gamePlays)
      .set({
        status: 'lost',
        params: JSON.stringify(params),
        hiddenState: JSON.stringify(next),
        score: null,
        settledAt: now,
      })
      .where(eq(gamePlays.id, play.id));
    return {
      playId: play.id,
      phase: 'settled',
      params,
      result: { playId: play.id, outcome: 'lost', prize: '0', score: null },
    };
  }

  const prize = play.prize ?? settings.prizeTak;
  await db
    .update(gamePlays)
    .set({ params: JSON.stringify(params), hiddenState: JSON.stringify(next), score: null })
    .where(eq(gamePlays.id, play.id));
  const result = await payOutWin(db, env, play, input.userId, prize, null, null);
  return { playId: play.id, phase: 'settled', params, result };
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

export async function listGames(db: Db, env: GamesEnv) {
  let casino: { publicKey: string; takBalance: string };
  try {
    casino = await getCasinoWithBalance(env);
  } catch {
    casino = { publicKey: '', takBalance: '0' };
  }
  const entries = await Promise.all(
    GAME_KEYS.map(async (gameKey) => {
      const settings = await getSettings(db, gameKey);
      if (!settings.enabled) return null;
      const descriptor = getGameDescriptor(gameKey);
      return {
        gameKey,
        titleKey: descriptor.titleKey,
        descriptionKey: descriptor.descriptionKey,
        settings,
        casinoPublicKey: casino.publicKey,
        playable:
          casino.publicKey !== '' && compareStroops(casino.takBalance, settings.prizeTak) >= 0,
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
