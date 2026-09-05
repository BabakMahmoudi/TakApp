import { z } from 'zod';
import { lumensFromStroops } from '@takapp/shared/money';
import type { AgentDataAccess } from '../db';
import { TAK_DECIMALS, createBalanceReader } from '../stellar';
import type { AgentEnv } from '../env';
import type { ToolDefinition } from '../llm/deepseek';

export interface ToolContext {
  env: AgentEnv;
  data: AgentDataAccess;
  publicKey: string | null;
}

const getShopMenuArgs = z.object({ shopId: z.number().int().positive() });
const getOrderHistoryArgs = z.object({ limit: z.number().int().min(1).max(50).optional() });

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'listShops',
    description: 'List active TakApp coffee shops with their names and addresses.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'getShopMenu',
    description: 'Get the menu items of a coffee shop by its numeric shop id.',
    parameters: {
      type: 'object',
      properties: { shopId: { type: 'integer', description: 'Coffee shop id' } },
      required: ['shopId'],
    },
  },
  {
    name: 'getTakTokenInfo',
    description: 'Get facts about the TAK token (contract id, decimals, supported assets).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'getUserBalance',
    description: 'Read the logged-in user XLM and TAK balances. Requires a logged-in user.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'getOrderHistory',
    description: 'List the logged-in user order history. Requires a logged-in user.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Maximum number of orders (1-50)' } },
    },
  },
];

export async function runTool(name: string, argumentsJson: string, ctx: ToolContext): Promise<string> {
  switch (name) {
    case 'listShops':
      return listShops(ctx.data);
    case 'getShopMenu':
      return getShopMenu(ctx.data, parseArgs(getShopMenuArgs, argumentsJson));
    case 'getTakTokenInfo':
      return getTakTokenInfo(ctx.env);
    case 'getUserBalance':
      return getUserBalance(ctx);
    case 'getOrderHistory':
      return getOrderHistory(ctx, parseArgs(getOrderHistoryArgs, argumentsJson));
    default:
      return `Unknown tool: ${name}`;
  }
}

function parseArgs<T extends z.ZodTypeAny>(schema: T, json: string): z.infer<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Invalid tool arguments (not JSON): ${json}`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid tool arguments: ${JSON.stringify(result.error.issues)}`);
  }
  return result.data;
}

async function listShops(data: AgentDataAccess): Promise<string> {
  const shops = await data.listShops();
  if (shops.length === 0) return 'No active coffee shops are listed right now.';
  return JSON.stringify(
    shops.map((shop) => ({ id: shop.id, name: shop.name, address: shop.address ?? null })),
  );
}

async function getShopMenu(data: AgentDataAccess, args: z.infer<typeof getShopMenuArgs>): Promise<string> {
  const items = await data.getShopMenu(args.shopId);
  if (items.length === 0) return 'This shop has no menu items yet.';
  return JSON.stringify(
    items.map((item) => ({ name: item.name, priceStroops: item.price, priceTak: lumensFromStroops(item.price) })),
  );
}

function getTakTokenInfo(env: AgentEnv): string {
  return JSON.stringify({
    symbol: 'TAK',
    decimals: TAK_DECIMALS,
    standard: 'SEP-41 (Soroban)',
    contractId: env.TAK_CONTRACT_ID,
    alsoSupports: 'XLM',
  });
}

async function getUserBalance(ctx: ToolContext): Promise<string> {
  if (!ctx.publicKey) return 'Log in to see your balance.';
  const reader = createBalanceReader(ctx.env);
  const entries = await reader.readBalances(ctx.publicKey);
  const formatted = entries.map((entry) => ({
    asset: entry.asset,
    amount: lumensFromStroops(entry.stroops),
  }));
  return JSON.stringify(formatted);
}

async function getOrderHistory(
  ctx: ToolContext,
  args: z.infer<typeof getOrderHistoryArgs>,
): Promise<string> {
  if (!ctx.publicKey) return 'Log in to see your order history.';
  const limit = args.limit ?? 10;
  const [orders, payments] = await Promise.all([
    ctx.data.listOrders(ctx.publicKey, limit),
    ctx.data.listPayments(ctx.publicKey, limit),
  ]);
  if (orders.length === 0 && payments.length === 0) return 'No orders yet.';
  return JSON.stringify({
    orders: orders.map((order) => ({
      id: order.id,
      status: order.status,
      totalTak: lumensFromStroops(order.totalAmount),
      createdAt: order.createdAt.toISOString(),
    })),
    payments: payments.map((payment) => ({
      asset: payment.asset,
      amount: lumensFromStroops(payment.amount),
      createdAt: payment.createdAt.toISOString(),
    })),
  });
}
