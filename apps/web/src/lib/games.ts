import type { Messages } from './i18n/messages';

export const GAME_KEYS = ['spin', 'tap', 'clock', 'blackjack'] as const;
export type GameKey = (typeof GAME_KEYS)[number];

export function isGameKey(value: string): value is GameKey {
  return (GAME_KEYS as readonly string[]).includes(value);
}

export type CommonSettings = {
  enabled: boolean;
  /** Fee the player pays to the casino to start a play, in stroops (string). */
  paidPlayFee: string;
  maxPaidPlaysPerDay: number;
  /** Prize paid to a winner, in stroops (string). Must be >= 1 TAK. */
  prizeTak: string;
  completionWindowSeconds: number;
};

export type SpinSettings = CommonSettings & {
  segments: number;
  winSegments: number;
};

export type TapSettings = CommonSettings & {
  durationSeconds: number;
  targetTaps: number;
};

export type ClockSettings = CommonSettings & {
  targetSeconds: number;
  toleranceMs: number;
};

export type BlackjackSettings = CommonSettings;

export type GameSettings = SpinSettings | TapSettings | ClockSettings | BlackjackSettings;

export type SpinParams = {
  game: 'spin';
  outcomeIndex: number;
  segments: number;
  winSegments: number;
};

export type TapParams = {
  game: 'tap';
  durationMs: number;
  targetTaps: number;
  startedAtMs: number;
};

export type ClockParams = {
  game: 'clock';
  targetMs: number;
  toleranceMs: number;
  startedAtMs: number;
};

export const BLACKJACK_SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
export type BlackjackSuit = (typeof BLACKJACK_SUITS)[number];

export const BLACKJACK_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export type BlackjackRank = (typeof BLACKJACK_RANKS)[number];

export type BlackjackCard = { suit: BlackjackSuit; rank: BlackjackRank };

export type BlackjackAction = 'hit' | 'stand';

export type BlackjackVisibleState = {
  phase: 'player_turn' | 'settled';
  playerCards: BlackjackCard[];
  dealerCards: BlackjackCard[];
  playerTotal: number;
  dealerTotal: number | null;
  outcome: 'won' | 'lost' | null;
};

export type BlackjackParams = BlackjackVisibleState & { game: 'blackjack' };

export type GameParams = SpinParams | TapParams | ClockParams | BlackjackParams;

export type SpinPerformance = { ack: true };

export type TapPerformance = { taps: number };

export type ClockPerformance = { elapsedMs: number };

export type GamePerformance = SpinPerformance | TapPerformance | ClockPerformance;

export type SettingField =
  | { key: string; type: 'number'; labelKey: keyof Messages; min: number; max: number; step?: number; unitKey?: keyof Messages }
  | { key: string; type: 'tak'; labelKey: keyof Messages }
  | { key: string; type: 'toggle'; labelKey: keyof Messages };

export type GameDescriptor = {
  key: GameKey;
  titleKey: keyof Messages;
  descriptionKey: keyof Messages;
  settingsFields: SettingField[];
};

const STROOPS_PER_TAK = '10000000';

const commonDefaults: CommonSettings = {
  enabled: true,
  paidPlayFee: STROOPS_PER_TAK,
  maxPaidPlaysPerDay: 100,
  prizeTak: STROOPS_PER_TAK,
  completionWindowSeconds: 60,
};

export const defaultSettings: Record<GameKey, GameSettings> = {
  spin: { ...commonDefaults, segments: 8, winSegments: 1 },
  tap: { ...commonDefaults, durationSeconds: 15, targetTaps: 30 },
  clock: { ...commonDefaults, targetSeconds: 10, toleranceMs: 100 },
  blackjack: { ...commonDefaults, completionWindowSeconds: 180 },
};

export const settingsFields: Record<GameKey, SettingField[]> = {
  spin: [
    { key: 'enabled', type: 'toggle', labelKey: 'games.fields.enabled' },
    { key: 'paidPlayFee', type: 'tak', labelKey: 'games.fields.paidPlayFee' },
    { key: 'maxPaidPlaysPerDay', type: 'number', labelKey: 'games.fields.maxPaidPlaysPerDay', min: 0, max: 10000 },
    { key: 'prizeTak', type: 'tak', labelKey: 'games.fields.prizeTak' },
    { key: 'completionWindowSeconds', type: 'number', labelKey: 'games.fields.completionWindowSeconds', min: 10, max: 600, unitKey: 'games.units.seconds' },
    { key: 'segments', type: 'number', labelKey: 'games.fields.segments', min: 2, max: 36 },
    { key: 'winSegments', type: 'number', labelKey: 'games.fields.winSegments', min: 1, max: 36 },
  ],
  tap: [
    { key: 'enabled', type: 'toggle', labelKey: 'games.fields.enabled' },
    { key: 'paidPlayFee', type: 'tak', labelKey: 'games.fields.paidPlayFee' },
    { key: 'maxPaidPlaysPerDay', type: 'number', labelKey: 'games.fields.maxPaidPlaysPerDay', min: 0, max: 10000 },
    { key: 'prizeTak', type: 'tak', labelKey: 'games.fields.prizeTak' },
    { key: 'completionWindowSeconds', type: 'number', labelKey: 'games.fields.completionWindowSeconds', min: 10, max: 600, unitKey: 'games.units.seconds' },
    { key: 'durationSeconds', type: 'number', labelKey: 'games.fields.durationSeconds', min: 5, max: 120, unitKey: 'games.units.seconds' },
    { key: 'targetTaps', type: 'number', labelKey: 'games.fields.targetTaps', min: 5, max: 500 },
  ],
  clock: [
    { key: 'enabled', type: 'toggle', labelKey: 'games.fields.enabled' },
    { key: 'paidPlayFee', type: 'tak', labelKey: 'games.fields.paidPlayFee' },
    { key: 'maxPaidPlaysPerDay', type: 'number', labelKey: 'games.fields.maxPaidPlaysPerDay', min: 0, max: 10000 },
    { key: 'prizeTak', type: 'tak', labelKey: 'games.fields.prizeTak' },
    { key: 'completionWindowSeconds', type: 'number', labelKey: 'games.fields.completionWindowSeconds', min: 10, max: 600, unitKey: 'games.units.seconds' },
    { key: 'targetSeconds', type: 'number', labelKey: 'games.fields.targetSeconds', min: 3, max: 60, step: 0.1, unitKey: 'games.units.seconds' },
    { key: 'toleranceMs', type: 'number', labelKey: 'games.fields.toleranceMs', min: 10, max: 1000, unitKey: 'games.units.ms' },
  ],
  blackjack: [
    { key: 'enabled', type: 'toggle', labelKey: 'games.fields.enabled' },
    { key: 'paidPlayFee', type: 'tak', labelKey: 'games.fields.paidPlayFee' },
    { key: 'maxPaidPlaysPerDay', type: 'number', labelKey: 'games.fields.maxPaidPlaysPerDay', min: 0, max: 10000 },
    { key: 'prizeTak', type: 'tak', labelKey: 'games.fields.prizeTak' },
    { key: 'completionWindowSeconds', type: 'number', labelKey: 'games.fields.completionWindowSeconds', min: 10, max: 600, unitKey: 'games.units.seconds' },
  ],
};

export const GAMES: GameDescriptor[] = [
  { key: 'spin', titleKey: 'games.spin.title', descriptionKey: 'games.spin.description', settingsFields: settingsFields.spin },
  { key: 'tap', titleKey: 'games.tap.title', descriptionKey: 'games.tap.description', settingsFields: settingsFields.tap },
  { key: 'clock', titleKey: 'games.clock.title', descriptionKey: 'games.clock.description', settingsFields: settingsFields.clock },
  { key: 'blackjack', titleKey: 'games.blackjack.title', descriptionKey: 'games.blackjack.description', settingsFields: settingsFields.blackjack },
];

export function getGameDescriptor(gameKey: GameKey): GameDescriptor {
  return GAMES.find((game) => game.key === gameKey)!;
}

export type SettleResult = {
  outcome: 'won' | 'lost';
  score: number | null;
};

export function settle(
  gameKey: GameKey,
  params: GameParams,
  performance: GamePerformance | null,
): SettleResult {
  switch (gameKey) {
    case 'spin': {
      const p = params as SpinParams;
      return {
        outcome: p.outcomeIndex < p.winSegments ? 'won' : 'lost',
        score: null,
      };
    }
    case 'tap': {
      const p = params as TapParams;
      const taps = (performance as TapPerformance | null)?.taps ?? 0;
      return { outcome: taps >= p.targetTaps ? 'won' : 'lost', score: taps };
    }
    case 'clock': {
      const p = params as ClockParams;
      const elapsed = (performance as ClockPerformance | null)?.elapsedMs ?? Number.POSITIVE_INFINITY;
      const score = Math.abs(elapsed - p.targetMs);
      return { outcome: score <= p.toleranceMs ? 'won' : 'lost', score };
    }
    case 'blackjack':
      throw new Error('blackjack is settled via the games.blackjack.action state machine');
  }
}

export function gameErrorKey(typedCode: string | undefined): keyof Messages {
  switch (typedCode) {
    case 'INVALID_GAME':
      return 'games.errors.invalidGame';
    case 'GAME_DISABLED':
      return 'games.errors.disabled';
    case 'GAME_ACCOUNT_NOT_READY':
      return 'games.errors.accountNotReady';
    case 'GAME_OUT_OF_FUNDS':
      return 'games.errors.outOfFunds';
    case 'GAME_IN_PROGRESS':
      return 'games.errors.inProgress';
    case 'PLAY_NOT_FOUND':
      return 'games.errors.playNotFound';
    case 'PLAY_EXPIRED':
      return 'games.errors.expired';
    case 'PLAY_NOT_PENDING':
      return 'games.errors.playNotPending';
    case 'INVALID_PERFORMANCE':
      return 'games.errors.invalidPerformance';
    case 'FEE_ALREADY_USED':
      return 'games.errors.feeAlreadyUsed';
    case 'FEE_REQUIRED':
      return 'games.errors.feeRequired';
    case 'PAYOUT_FAILED':
      return 'games.errors.payoutFailed';
    default:
      return 'errors.generic';
  }
}
