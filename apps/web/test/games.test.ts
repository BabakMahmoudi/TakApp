import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk/no-axios';
import type { TrpcContext } from '../src/server/trpc/context';
import { MockDb, type MockDbTable } from './helpers/mock-db';
import { fetchTakBalance } from '../src/server/stellar/horizon';
import { submitTakTransfer } from '../src/server/stellar/tak-transfer';
import { settle, gameErrorKey } from '../src/lib/games';
import {
  GameError,
  finishGame,
  isValidPerformance,
  playDayStart,
  retryPayoutForAdmin,
  settingsSchemaByGame,
  startGame,
  toTrpcGameError,
  type FinishResult,
} from '../src/server/games/service';

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: unknown, value: unknown) => ({ kind: 'eq', column, value }),
    and: (...conds: unknown[]) => ({ kind: 'and', conds }),
    inArray: (column: unknown, values: unknown[]) => ({ kind: 'inArray', column, values }),
    gte: (column: unknown, value: unknown) => ({ kind: 'gte', column, value }),
    desc: (column: unknown) => ({ kind: 'desc', column }),
  };
});

vi.mock('../src/server/stellar/horizon', () => ({
  fetchTakBalance: vi.fn(),
}));

vi.mock('../src/server/stellar/tak-transfer', () => ({
  submitTakTransfer: vi.fn(),
}));

const casinoKeypair = Keypair.random();
const USER_ID = 1;
const USER_PUBLIC_KEY = `G${'U'.repeat(55)}`;

function user() {
  return {
    id: USER_ID,
    stellarPublicKey: USER_PUBLIC_KEY,
    email: 'user@example.com',
    phone: null,
    displayName: 'User',
    passwordHash: 'pbkdf2$SHA-256$i=100000$abc$def',
    verificationState: 'verified',
    role: 'user',
    totpSecret: null,
    createdAt: new Date(),
  };
}

function spinSettings(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    freePlaysPerDay: 3,
    paidPlayFee: '10000000',
    maxPaidPlaysPerDay: 100,
    prizeTak: '10000000',
    completionWindowSeconds: 60,
    segments: 8,
    winSegments: 1,
    ...overrides,
  };
}

function makeDb(overrides: { gameSettings?: Record<string, unknown>[]; gamePlays?: Record<string, unknown>[]; payments?: Record<string, unknown>[] } = {}) {
  const tables: Record<string, MockDbTable> = {
    users: { rows: [user()] },
    game_settings: { rows: overrides.gameSettings ?? [] },
    game_plays: { rows: overrides.gamePlays ?? [] },
    payments: { rows: overrides.payments ?? [] },
    admin_audit_log: { rows: [] },
  };
  return new MockDb(tables);
}

function makeEnv(overrides: Partial<Parameters<typeof startGame>[1]> = {}) {
  return {
    GAME_ACCOUNT_SECRET: casinoKeypair.secret(),
    HORIZON_URL: 'https://horizon-testnet.stellar.org',
    SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
    NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
    TAK_CONTRACT_ID: 'CBI3WR5NQZUQ5PAPV4TBCOFMJ3MOJVZVMH5CKCGVOP63YV2SPFZN3Z7C',
    ...overrides,
  };
}

function asDb(db: MockDb): TrpcContext['db'] {
  return db as unknown as TrpcContext['db'];
}

async function gameErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof GameError ? error.code : undefined;
  }
}

describe('settle', () => {
  it('spin wins when the outcome index is within the win segments', () => {
    const result = settle('spin', { game: 'spin', outcomeIndex: 0, segments: 8, winSegments: 1 }, null);
    expect(result.outcome).toBe('won');
    expect(result.score).toBeNull();
  });

  it('spin loses outside the win segments', () => {
    const result = settle('spin', { game: 'spin', outcomeIndex: 1, segments: 8, winSegments: 1 }, null);
    expect(result.outcome).toBe('lost');
  });

  it('tap wins at exactly the target and loses below it', () => {
    const params = { game: 'tap' as const, durationMs: 15000, targetTaps: 30, startedAtMs: 0 };
    expect(settle('tap', params, { taps: 30 }).outcome).toBe('won');
    expect(settle('tap', params, { taps: 29 }).outcome).toBe('lost');
  });

  it('clock wins inside tolerance and loses beyond it', () => {
    const params = { game: 'clock' as const, targetMs: 10000, toleranceMs: 100, startedAtMs: 0 };
    expect(settle('clock', params, { elapsedMs: 10100 }).outcome).toBe('won');
    expect(settle('clock', params, { elapsedMs: 10101 }).outcome).toBe('lost');
  });
});

describe('gameErrorKey', () => {
  it('maps known codes to i18n keys', () => {
    expect(gameErrorKey('GAME_IN_PROGRESS')).toBe('games.errors.inProgress');
    expect(gameErrorKey('PAYOUT_FAILED')).toBe('games.errors.payoutFailed');
  });

  it('falls back to a generic key for unknown codes', () => {
    expect(gameErrorKey(undefined)).toBe('errors.generic');
    expect(gameErrorKey('NOPE')).toBe('errors.generic');
  });
});

describe('playDayStart', () => {
  it('is deterministic for the same instant', () => {
    const instant = new Date('2026-01-01T12:00:00Z');
    expect(playDayStart(instant).getTime()).toBe(playDayStart(instant).getTime());
  });

  it('returns the Tehran day-start boundary (03:30 UTC)', () => {
    const start = playDayStart(new Date('2026-01-01T12:00:00Z'));
    expect(start.getUTCHours()).toBe(3);
    expect(start.getUTCMinutes()).toBe(30);
  });
});

describe('isValidPerformance', () => {
  it('accepts spin only with ack=true', () => {
    const params = { game: 'spin' as const, outcomeIndex: 0, segments: 8, winSegments: 1 };
    expect(isValidPerformance('spin', { ack: true }, params, 60)).toBe(true);
    expect(isValidPerformance('spin', { ack: false }, params, 60)).toBe(false);
  });

  it('caps tap performance at 3x the target', () => {
    const params = { game: 'tap' as const, durationMs: 15000, targetTaps: 30, startedAtMs: 0 };
    expect(isValidPerformance('tap', { taps: 90 }, params, 60)).toBe(true);
    expect(isValidPerformance('tap', { taps: 91 }, params, 60)).toBe(false);
    expect(isValidPerformance('tap', { taps: -1 }, params, 60)).toBe(false);
  });

  it('caps clock performance at the completion window', () => {
    const params = { game: 'clock' as const, targetMs: 10000, toleranceMs: 100, startedAtMs: 0 };
    expect(isValidPerformance('clock', { elapsedMs: 60_000 }, params, 60)).toBe(true);
    expect(isValidPerformance('clock', { elapsedMs: 60_001 }, params, 60)).toBe(false);
  });
});

describe('settings validation', () => {
  it('rejects a prize below 1 TAK', () => {
    const parsed = settingsSchemaByGame.spin.safeParse(spinSettings({ prizeTak: '9999999' }));
    expect(parsed.success).toBe(false);
  });

  it('rejects winSegments greater than segments', () => {
    const parsed = settingsSchemaByGame.spin.safeParse(spinSettings({ segments: 8, winSegments: 9 }));
    expect(parsed.success).toBe(false);
  });

  it('accepts a valid spin settings object', () => {
    const parsed = settingsSchemaByGame.spin.safeParse(spinSettings());
    expect(parsed.success).toBe(true);
  });
});

describe('toTrpcGameError', () => {
  it('maps GAME_IN_PROGRESS to CONFLICT and carries the typed code', () => {
    const error = toTrpcGameError(new GameError('in progress', 'GAME_IN_PROGRESS'));
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('GAME_IN_PROGRESS');
  });

  it('maps PLAY_NOT_FOUND to NOT_FOUND', () => {
    const error = toTrpcGameError(new GameError('missing', 'PLAY_NOT_FOUND'));
    expect(error.code).toBe('NOT_FOUND');
  });
});

describe('startGame', () => {
  beforeEach(() => {
    vi.mocked(fetchTakBalance).mockReset();
    vi.mocked(fetchTakBalance).mockResolvedValue('100000000');
    vi.mocked(submitTakTransfer).mockReset();
  });

  it('rejects a disabled game', async () => {
    const db = makeDb({
      gameSettings: [
        { id: 1, gameKey: 'spin', settings: JSON.stringify(spinSettings({ enabled: false })), updatedByUserId: null, updatedAt: new Date() },
      ],
    });
    const code = await gameErrorCode(startGame(asDb(db), makeEnv(), { userId: USER_ID, gameKey: 'spin' }));
    expect(code).toBe('GAME_DISABLED');
  });

  it('rejects when the casino secret is invalid', async () => {
    const db = makeDb();
    const code = await gameErrorCode(
      startGame(asDb(db), makeEnv({ GAME_ACCOUNT_SECRET: 'not-a-secret' }), { userId: USER_ID, gameKey: 'spin' }),
    );
    expect(code).toBe('GAME_ACCOUNT_NOT_READY');
  });

  it('rejects when the casino cannot cover the prize', async () => {
    vi.mocked(fetchTakBalance).mockResolvedValue('9999999');
    const db = makeDb();
    const code = await gameErrorCode(startGame(asDb(db), makeEnv(), { userId: USER_ID, gameKey: 'spin' }));
    expect(code).toBe('GAME_OUT_OF_FUNDS');
  });

  it('rejects when the daily free limit is reached', async () => {
    // createdAt is pushed into the future so it is always >= the Tehran day-start
    // boundary regardless of the machine's timezone.
    const settled = new Date(Date.now() + 24 * 3600 * 1000);
    const plays = [0, 1, 2].map((i) => ({
      id: i + 1,
      gameKey: 'spin',
      userId: USER_ID,
      playType: 'free',
      status: 'won',
      params: JSON.stringify({ game: 'spin', outcomeIndex: 0, segments: 8, winSegments: 1 }),
      performance: null,
      score: null,
      prize: '10000000',
      payoutTxHash: null,
      startedAt: settled,
      settledAt: settled,
      createdAt: settled,
    }));
    const db = makeDb({ gamePlays: plays });
    const code = await gameErrorCode(startGame(asDb(db), makeEnv(), { userId: USER_ID, gameKey: 'spin' }));
    expect(code).toBe('DAILY_PLAY_LIMIT');
  });

  it('rejects with GAME_IN_PROGRESS when a fresh pending play exists', async () => {
    const db = makeDb({
      gamePlays: [
        {
          id: 1,
          gameKey: 'spin',
          userId: USER_ID,
          playType: 'free',
          status: 'pending',
          params: JSON.stringify({ game: 'spin', outcomeIndex: 0, segments: 8, winSegments: 1 }),
          performance: null,
          score: null,
          prize: '10000000',
          payoutTxHash: null,
          startedAt: new Date(),
          settledAt: null,
          createdAt: new Date(),
        },
      ],
    });
    const code = await gameErrorCode(startGame(asDb(db), makeEnv(), { userId: USER_ID, gameKey: 'spin' }));
    expect(code).toBe('GAME_IN_PROGRESS');
  });

  it('abandons an expired pending play and starts a new one', async () => {
    const db = makeDb({
      gamePlays: [
        {
          id: 1,
          gameKey: 'spin',
          userId: USER_ID,
          playType: 'free',
          status: 'pending',
          params: JSON.stringify({ game: 'spin', outcomeIndex: 0, segments: 8, winSegments: 1 }),
          performance: null,
          score: null,
          prize: '10000000',
          payoutTxHash: null,
          startedAt: new Date(Date.now() - 120_000),
          settledAt: null,
          createdAt: new Date(Date.now() - 120_000),
        },
      ],
    });
    const result = await startGame(asDb(db), makeEnv(), { userId: USER_ID, gameKey: 'spin' });
    expect(result.playId).toBe(2);
    const rows = db.table('game_plays').rows;
    expect(rows.find((row) => row.id === 1)?.status).toBe('abandoned');
    expect(rows.find((row) => row.id === 2)?.status).toBe('pending');
  });
});

describe('finishGame', () => {
  beforeEach(() => {
    vi.mocked(fetchTakBalance).mockReset();
    vi.mocked(fetchTakBalance).mockResolvedValue('100000000');
    vi.mocked(submitTakTransfer).mockReset();
    vi.mocked(submitTakTransfer).mockResolvedValue({ txHash: 'tx-hash', envelopeXdr: 'xdr' });
  });

  function pendingSpinPlay(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      gameKey: 'spin',
      userId: USER_ID,
      playType: 'free',
      status: 'pending',
      params: JSON.stringify({ game: 'spin', outcomeIndex: 0, segments: 8, winSegments: 1 }),
      performance: null,
      score: null,
      prize: '10000000',
      payoutTxHash: null,
      startedAt: new Date(),
      settledAt: null,
      createdAt: new Date(),
      ...overrides,
    };
  }

  it('rejects a missing play', async () => {
    const db = makeDb();
    const code = await gameErrorCode(
      finishGame(asDb(db), makeEnv(), { userId: USER_ID, playId: 99, performance: { ack: true } }),
    );
    expect(code).toBe('PLAY_NOT_FOUND');
  });

  it('abandons an expired pending play', async () => {
    const db = makeDb({
      gamePlays: [pendingSpinPlay({ startedAt: new Date(Date.now() - 120_000), createdAt: new Date(Date.now() - 120_000) })],
    });
    const result = await finishGame(asDb(db), makeEnv(), { userId: USER_ID, playId: 1, performance: { ack: true } });
    expect(result.outcome).toBe('abandoned');
    expect(db.table('game_plays').rows[0]?.status).toBe('abandoned');
  });

  it('rejects tampered performance beyond the tap cap', async () => {
    const db = makeDb({
      gamePlays: [
        pendingSpinPlay({
          gameKey: 'tap',
          params: JSON.stringify({ game: 'tap', durationMs: 15000, targetTaps: 30, startedAtMs: Date.now() }),
        }),
      ],
    });
    const code = await gameErrorCode(
      finishGame(asDb(db), makeEnv(), { userId: USER_ID, playId: 1, performance: { taps: 91 } }),
    );
    expect(code).toBe('INVALID_PERFORMANCE');
  });

  it('pays the prize and records a payments row on a win', async () => {
    const db = makeDb({ gamePlays: [pendingSpinPlay()] });
    const result = await finishGame(asDb(db), makeEnv(), { userId: USER_ID, playId: 1, performance: { ack: true } });
    expect(result.outcome).toBe('won');
    expect(result.prize).toBe('10000000');
    expect(submitTakTransfer).toHaveBeenCalledOnce();
    expect(db.table('game_plays').rows[0]?.status).toBe('won');
    expect(db.table('game_plays').rows[0]?.payoutTxHash).toBe('tx-hash');
    expect(db.table('payments').rows).toHaveLength(1);
  });

  it('marks payout_failed and throws when the payout submission fails', async () => {
    vi.mocked(submitTakTransfer).mockRejectedValue(new Error('boom'));
    const db = makeDb({ gamePlays: [pendingSpinPlay()] });
    const code = await gameErrorCode(
      finishGame(asDb(db), makeEnv(), { userId: USER_ID, playId: 1, performance: { ack: true } }),
    );
    expect(code).toBe('PAYOUT_FAILED');
    expect(db.table('game_plays').rows[0]?.status).toBe('payout_failed');
  });

  it('returns the stored result on a second finish (idempotent)', async () => {
    const db = makeDb({ gamePlays: [pendingSpinPlay()] });
    const first = await finishGame(asDb(db), makeEnv(), { userId: USER_ID, playId: 1, performance: { ack: true } });
    const second = await finishGame(asDb(db), makeEnv(), { userId: USER_ID, playId: 1, performance: { ack: true } });
    expect(first.outcome).toBe('won');
    expect(second.outcome).toBe('won');
    expect((second as FinishResult).prize).toBe('10000000');
    expect(submitTakTransfer).toHaveBeenCalledOnce();
    expect(db.table('payments').rows).toHaveLength(1);
  });
});

describe('retryPayoutForAdmin', () => {
  beforeEach(() => {
    vi.mocked(fetchTakBalance).mockReset();
    vi.mocked(fetchTakBalance).mockResolvedValue('100000000');
    vi.mocked(submitTakTransfer).mockReset();
    vi.mocked(submitTakTransfer).mockResolvedValue({ txHash: 'tx-hash-2', envelopeXdr: 'xdr' });
  });

  it('moves a payout_failed play to won with a fresh tx hash', async () => {
    const db = makeDb({
      gamePlays: [
        {
          id: 1,
          gameKey: 'spin',
          userId: USER_ID,
          playType: 'free',
          status: 'payout_failed',
          params: JSON.stringify({ game: 'spin', outcomeIndex: 0, segments: 8, winSegments: 1 }),
          performance: JSON.stringify({ ack: true }),
          score: null,
          prize: '10000000',
          payoutTxHash: null,
          startedAt: new Date(),
          settledAt: new Date(),
          createdAt: new Date(),
        },
      ],
    });
    const result = await retryPayoutForAdmin(asDb(db), makeEnv(), { actorUserId: USER_ID, playId: 1 });
    expect(result.outcome).toBe('won');
    expect(db.table('game_plays').rows[0]?.status).toBe('won');
    expect(db.table('game_plays').rows[0]?.payoutTxHash).toBe('tx-hash-2');
  });

  it('rejects a play that is not awaiting payout', async () => {
    const db = makeDb();
    const code = await gameErrorCode(retryPayoutForAdmin(asDb(db), makeEnv(), { actorUserId: USER_ID, playId: 99 }));
    expect(code).toBe('PLAY_NOT_FOUND');
  });
});
