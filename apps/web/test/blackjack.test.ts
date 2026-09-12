import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk/no-axios';
import type { TrpcContext } from '../src/server/trpc/context';
import type { BlackjackParams } from '../src/lib/games';
import { MockDb, type MockDbTable } from './helpers/mock-db';
import { fetchTakBalance } from '../src/server/stellar/horizon';
import { submitTakTransfer } from '../src/server/stellar/tak-transfer';
import {
  applyStand,
  blackjackOutcome,
  deal,
  handValue,
  isBlackjack,
  newShoe,
  visibleState,
  type Card,
} from '../src/server/games/blackjack';
import {
  blackjackAction,
  GameError,
  getGameHistory,
  startGame,
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
const FEE_HASH = 'f'.repeat(64);

function card(rank: string, suit: Card['suit'] = 'hearts'): Card {
  return { rank, suit } as Card;
}

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

function makeDb(overrides: { gamePlays?: Record<string, unknown>[]; payments?: Record<string, unknown>[] } = {}) {
  const tables: Record<string, MockDbTable> = {
    users: { rows: [user()] },
    game_settings: { rows: [] },
    game_plays: { rows: overrides.gamePlays ?? [] },
    payments: { rows: overrides.payments ?? [], unique: ['txHash'] },
    admin_audit_log: { rows: [] },
  };
  return new MockDb(tables);
}

function makeEnv(overrides: Record<string, unknown> = {}) {
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

function blackjackRow(opts: {
  id?: number;
  status?: string;
  deck?: Card[];
  playerCards: Card[];
  dealerCards: Card[];
  startedAt?: Date;
}) {
  const hidden = { deck: opts.deck ?? [], playerCards: opts.playerCards, dealerCards: opts.dealerCards };
  const settled = opts.status !== undefined && opts.status !== 'pending';
  const outcome = settled ? (opts.status === 'won' ? ('won' as const) : ('lost' as const)) : null;
  const visible = visibleState(hidden, { settled, outcome });
  return {
    id: opts.id ?? 1,
    gameKey: 'blackjack',
    userId: USER_ID,
    playType: 'paid',
    status: opts.status ?? 'pending',
    params: JSON.stringify({ game: 'blackjack', ...visible }),
    hiddenState: JSON.stringify(hidden),
    performance: null,
    score: null,
    prize: '10000000',
    payoutTxHash: null,
    startedAt: opts.startedAt ?? new Date(),
    settledAt: settled ? new Date() : null,
    createdAt: new Date(),
  };
}

describe('handValue', () => {
  it('counts a single ace as 11', () => {
    expect(handValue([card('A'), card('9')])).toBe(20);
  });

  it('softens an ace to 1 when 11 would bust', () => {
    expect(handValue([card('A'), card('K'), card('5')])).toBe(16);
    expect(handValue([card('A'), card('A')])).toBe(12);
  });

  it('scores face cards as 10', () => {
    expect(handValue([card('K'), card('Q')])).toBe(20);
    expect(handValue([card('J'), card('7')])).toBe(17);
  });
});

describe('isBlackjack', () => {
  it('is true for a two-card 21', () => {
    expect(isBlackjack([card('A'), card('K')])).toBe(true);
  });

  it('is false for more than two cards or non-21 totals', () => {
    expect(isBlackjack([card('A'), card('K'), card('2')])).toBe(false);
    expect(isBlackjack([card('10'), card('10')])).toBe(false);
  });
});

describe('blackjackOutcome', () => {
  it('wins when the player beats the dealer', () => {
    expect(blackjackOutcome([card('K'), card('9')], [card('10'), card('7')])).toBe('win');
  });

  it('loses when the dealer is higher', () => {
    expect(blackjackOutcome([card('K'), card('8')], [card('10'), card('9')])).toBe('loss');
  });

  it('treats a push as a loss', () => {
    expect(blackjackOutcome([card('K'), card('7')], [card('10'), card('7')])).toBe('loss');
  });

  it('loses on a player bust regardless of the dealer', () => {
    expect(blackjackOutcome([card('K'), card('K'), card('K')], [card('2'), card('3')])).toBe('loss');
  });

  it('wins when the dealer busts', () => {
    expect(blackjackOutcome([card('K'), card('7')], [card('10'), card('6'), card('10')])).toBe('win');
  });
});

describe('newShoe / deal / applyStand', () => {
  it('builds a full shoe and deals 2 + 2 without overlap', () => {
    const shoe = newShoe(6);
    expect(shoe).toHaveLength(52 * 6);
    const state = deal(shoe);
    expect(state.playerCards).toHaveLength(2);
    expect(state.dealerCards).toHaveLength(2);
    expect(state.deck).toHaveLength(52 * 6 - 4);
  });

  it('dealer draws to 17 and stands on soft 17', () => {
    const hit = applyStand({ deck: [card('9', 'clubs')], playerCards: [card('K')], dealerCards: [card('7'), card('A')] });
    expect(handValue(hit.dealerCards)).toBe(18);

    const softStand = applyStand({ deck: [card('10', 'clubs')], playerCards: [card('K')], dealerCards: [card('A'), card('6')] });
    expect(handValue(softStand.dealerCards)).toBe(17);
  });
});

describe('startGame blackjack', () => {
  beforeEach(() => {
    vi.mocked(fetchTakBalance).mockReset();
    vi.mocked(fetchTakBalance).mockResolvedValue('100000000');
    vi.mocked(submitTakTransfer).mockReset();
  });

  it('deals 2 + 2, writes hidden state, and returns only the visible state', async () => {
    const db = makeDb();
    const result = await startGame(asDb(db), makeEnv(), { userId: USER_ID, gameKey: 'blackjack', feeTxHash: FEE_HASH });
    const params = result.params as BlackjackParams;

    expect(params.game).toBe('blackjack');
    expect(params.playerCards).toHaveLength(2);
    expect(params.dealerCards).toHaveLength(1);
    expect(params.dealerTotal).toBeNull();
    expect(params.phase).toBe('player_turn');
    expect(params.outcome).toBeNull();

    const play = db.table('game_plays').rows[0];
    const hidden = JSON.parse(String(play?.hiddenState)) as { deck: Card[]; playerCards: Card[]; dealerCards: Card[] };
    expect(hidden.playerCards).toHaveLength(2);
    expect(hidden.dealerCards).toHaveLength(2);
    expect(hidden.deck).toHaveLength(52 * 6 - 4);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('hidden_state');
    expect(serialized).not.toContain('deck');
  });
});

describe('blackjackAction', () => {
  beforeEach(() => {
    vi.mocked(fetchTakBalance).mockReset();
    vi.mocked(fetchTakBalance).mockResolvedValue('100000000');
    vi.mocked(submitTakTransfer).mockReset();
    vi.mocked(submitTakTransfer).mockResolvedValue({ txHash: 'tx-hash', envelopeXdr: 'xdr' });
  });

  it('rejects a non-blackjack play', async () => {
    const db = makeDb({
      gamePlays: [
        {
          ...blackjackRow({ playerCards: [card('K')], dealerCards: [card('9')] }),
          gameKey: 'spin',
        },
      ],
    });
    const code = await gameErrorCode(blackjackAction(asDb(db), makeEnv(), { userId: USER_ID, playId: 1, action: 'hit' }));
    expect(code).toBe('INVALID_GAME');
  });

  it('hit draws the top card and persists the new state', async () => {
    const db = makeDb({
      gamePlays: [
        blackjackRow({
          playerCards: [card('A'), card('9')],
          dealerCards: [card('K', 'clubs'), card('7', 'clubs')],
          deck: [card('2', 'spades')],
        }),
      ],
    });
    const res = await blackjackAction(asDb(db), makeEnv(), { userId: USER_ID, playId: 1, action: 'hit' });
    expect(res.phase).toBe('player_turn');
    expect(res.result).toBeNull();
    expect(res.params.playerCards).toHaveLength(3);
    expect(res.params.dealerCards).toHaveLength(1);

    const play = db.table('game_plays').rows[0];
    expect(play?.status).toBe('pending');
    const hidden = JSON.parse(String(play?.hiddenState)) as { deck: Card[]; playerCards: Card[] };
    expect(hidden.deck).toHaveLength(0);
    expect(hidden.playerCards).toHaveLength(3);
  });

  it('hit to a bust resolves a loss without a payout', async () => {
    const db = makeDb({
      gamePlays: [
        blackjackRow({
          playerCards: [card('K'), card('K')],
          dealerCards: [card('9', 'clubs'), card('7', 'clubs')],
          deck: [card('10', 'spades')],
        }),
      ],
    });
    const res = await blackjackAction(asDb(db), makeEnv(), { userId: USER_ID, playId: 1, action: 'hit' });
    expect(res.phase).toBe('settled');
    expect(res.result?.outcome).toBe('lost');
    expect(submitTakTransfer).not.toHaveBeenCalled();
    expect(db.table('game_plays').rows[0]?.status).toBe('lost');
  });

  it('stand with a higher hand wins and pays the prize', async () => {
    const db = makeDb({
      gamePlays: [
        blackjackRow({
          playerCards: [card('K'), card('9')],
          dealerCards: [card('10', 'clubs'), card('7', 'clubs')],
        }),
      ],
    });
    const res = await blackjackAction(asDb(db), makeEnv(), { userId: USER_ID, playId: 1, action: 'stand' });
    expect(res.phase).toBe('settled');
    expect(res.result?.outcome).toBe('won');
    expect(res.result?.prize).toBe('10000000');
    expect(submitTakTransfer).toHaveBeenCalledOnce();
    expect(db.table('game_plays').rows[0]?.status).toBe('won');
    expect(db.table('game_plays').rows[0]?.payoutTxHash).toBe('tx-hash');
  });

  it('stand on a push resolves a loss without a payout', async () => {
    const db = makeDb({
      gamePlays: [
        blackjackRow({
          playerCards: [card('K'), card('7')],
          dealerCards: [card('10', 'clubs'), card('7', 'clubs')],
        }),
      ],
    });
    const res = await blackjackAction(asDb(db), makeEnv(), { userId: USER_ID, playId: 1, action: 'stand' });
    expect(res.result?.outcome).toBe('lost');
    expect(submitTakTransfer).not.toHaveBeenCalled();
    expect(db.table('game_plays').rows[0]?.status).toBe('lost');
  });

  it('expired plays are abandoned', async () => {
    const db = makeDb({
      gamePlays: [
        blackjackRow({
          playerCards: [card('K'), card('7')],
          dealerCards: [card('10', 'clubs'), card('7', 'clubs')],
          startedAt: new Date(Date.now() - 200_000),
        }),
      ],
    });
    const res = await blackjackAction(asDb(db), makeEnv(), { userId: USER_ID, playId: 1, action: 'hit' });
    expect(res.result?.outcome).toBe('abandoned');
    expect(db.table('game_plays').rows[0]?.status).toBe('abandoned');
  });
});

describe('hidden-state leak prevention', () => {
  beforeEach(() => {
    vi.mocked(fetchTakBalance).mockReset();
    vi.mocked(fetchTakBalance).mockResolvedValue('100000000');
    vi.mocked(submitTakTransfer).mockReset();
    vi.mocked(submitTakTransfer).mockResolvedValue({ txHash: 'tx-hash', envelopeXdr: 'xdr' });
  });

  it('getGameHistory never surfaces the hole card or the deck', async () => {
    const db = makeDb({
      gamePlays: [
        blackjackRow({
          playerCards: [card('K'), card('9')],
          dealerCards: [card('10', 'clubs'), card('A', 'spades')],
          deck: [card('2', 'spades')],
        }),
      ],
    });
    const history = await getGameHistory(asDb(db), USER_ID);
    expect(history).toHaveLength(1);
    expect(history[0]).not.toHaveProperty('hiddenState');
    const serialized = JSON.stringify(history);
    expect(serialized).not.toContain('hidden_state');
    expect(serialized).not.toContain('"deck"');
    expect(serialized).not.toContain('"suit":"spades"');
  });
});
