import {
  BLACKJACK_RANKS,
  BLACKJACK_SUITS,
  type BlackjackCard,
  type BlackjackRank,
  type BlackjackSuit,
  type BlackjackVisibleState,
} from '../../lib/games';

export type Suit = BlackjackSuit;
export type Rank = BlackjackRank;
export type Card = BlackjackCard;

export type BlackjackHiddenState = {
  deck: Card[];
  playerCards: Card[];
  dealerCards: Card[];
};

export const BLACKJACK_DECKS = 6;

function randomInt(maxExclusive: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] ?? 0) % maxExclusive;
}

export function newShoe(decks = BLACKJACK_DECKS): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of BLACKJACK_SUITS) {
      for (const rank of BLACKJACK_RANKS) {
        cards.push({ suit, rank });
      }
    }
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = cards[i]!;
    cards[i] = cards[j]!;
    cards[j] = tmp;
  }
  return cards;
}

export function rankValue(rank: Rank): number {
  switch (rank) {
    case 'A':
      return 11;
    case 'K':
    case 'Q':
    case 'J':
      return 10;
    default:
      return Number(rank);
  }
}

export function handValue(cards: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === 'A') {
      aces += 1;
      total += 11;
    } else {
      total += rankValue(card.rank);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards) === 21;
}

export function isBust(cards: Card[]): boolean {
  return handValue(cards) > 21;
}

export function deal(deck: Card[]): BlackjackHiddenState {
  const shoe = deck.slice();
  const playerCards = [shoe.pop()!, shoe.pop()!];
  const dealerCards = [shoe.pop()!, shoe.pop()!];
  return { deck: shoe, playerCards, dealerCards };
}

export function applyHit(state: BlackjackHiddenState): BlackjackHiddenState {
  const shoe = state.deck.slice();
  const card = shoe.pop();
  if (!card) return state;
  return { deck: shoe, playerCards: [...state.playerCards, card], dealerCards: state.dealerCards };
}

export function applyStand(state: BlackjackHiddenState): BlackjackHiddenState {
  const shoe = state.deck.slice();
  const dealerCards = state.dealerCards.slice();
  while (handValue(dealerCards) < 17) {
    const card = shoe.pop();
    if (!card) break;
    dealerCards.push(card);
  }
  return { deck: shoe, playerCards: state.playerCards, dealerCards };
}

export function blackjackOutcome(playerCards: Card[], dealerCards: Card[]): 'win' | 'loss' {
  const player = handValue(playerCards);
  if (player > 21) return 'loss';
  const dealer = handValue(dealerCards);
  if (dealer > 21) return 'win';
  return player > dealer ? 'win' : 'loss';
}

export function visibleState(
  state: BlackjackHiddenState,
  opts: { settled: boolean; outcome: 'won' | 'lost' | null },
): BlackjackVisibleState {
  return {
    phase: opts.settled ? 'settled' : 'player_turn',
    playerCards: state.playerCards,
    dealerCards: opts.settled ? state.dealerCards : state.dealerCards.slice(0, 1),
    playerTotal: handValue(state.playerCards),
    dealerTotal: opts.settled ? handValue(state.dealerCards) : null,
    outcome: opts.outcome,
  };
}
