import { lumensFromStroops } from '@takapp/shared/money';
import type { BotDataAccess } from '../db';
import type { BalanceReader } from '../stellar';

export const BIND_PROMPT = [
  'Your Telegram account is not linked to a TakApp wallet yet.',
  'Open the TakApp web app, log in, and link your Telegram account there.',
].join('\n');

export async function handleBalance(
  data: BotDataAccess,
  balances: BalanceReader,
  telegramUserId: number,
): Promise<string> {
  const user = await data.findUserByTelegramId(telegramUserId);
  if (!user) return BIND_PROMPT;
  const entries = await balances.readBalances(user.publicKey);
  if (entries.length === 0) return 'No balances found.';
  return entries.map((entry) => `${entry.asset}: ${lumensFromStroops(entry.stroops)}`).join('\n');
}

export async function handleShops(data: BotDataAccess, telegramUserId: number): Promise<string> {
  const user = await data.findUserByTelegramId(telegramUserId);
  if (!user) return BIND_PROMPT;
  const shops = await data.listShops();
  if (shops.length === 0) return 'No coffee shops listed yet.';
  return shops.map((shop) => shop.address ? `${shop.name} — ${shop.address}` : shop.name).join('\n');
}

export async function handleHistory(
  data: BotDataAccess,
  telegramUserId: number,
  limit: number,
): Promise<string> {
  const user = await data.findUserByTelegramId(telegramUserId);
  if (!user) return BIND_PROMPT;
  const payments = await data.listPayments(user.publicKey, limit);
  if (payments.length === 0) return 'No payments yet.';
  return payments
    .map((payment) => `${payment.createdAt.toISOString()} ${payment.asset}: ${payment.amount} stroops`)
    .join('\n');
}
