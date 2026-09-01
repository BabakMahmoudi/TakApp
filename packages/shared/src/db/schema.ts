import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  stellarPublicKey: text('stellar_public_key').notNull().unique(),
  email: text('email').unique(),
  phone: text('phone').unique(),
  displayName: text('display_name'),
  passwordHash: text('password_hash').notNull(),
  verificationState: text('verification_state').notNull().default('unverified'),
  role: text('role').notNull().default('user'),
  totpSecret: text('totp_secret'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  nonce: text('nonce').notNull().unique(),
  token: text('token'),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const verifications = sqliteTable('verifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  type: text('type').notNull(),
  identifier: text('identifier').notNull(),
  status: text('status').notNull().default('pending'),
  codeDigest: text('code_digest'),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const telegramBindings = sqliteTable('telegram_bindings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  telegramUserId: integer('telegram_user_id').notNull().unique(),
  telegramUsername: text('telegram_username'),
  isAuthorized: integer('is_authorized', { mode: 'boolean' }).notNull().default(true),
  boundAt: integer('bound_at', { mode: 'timestamp_ms' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
});

export const conversations = sqliteTable('conversations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  telegramChatId: integer('telegram_chat_id').notNull(),
  context: text('context'),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const coffeeShops = sqliteTable('coffee_shops', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ownerUserId: integer('owner_user_id').references(() => users.id),
  name: text('name').notNull(),
  address: text('address'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const adminAuditLog = sqliteTable('admin_audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  action: text('action').notNull(),
  target: text('target'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const adminStepUpAttempts = sqliteTable('admin_step_up_attempts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .unique()
    .references(() => users.id),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: integer('locked_until', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const payments = sqliteTable('payments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  coffeeShopId: integer('coffee_shop_id').references(() => coffeeShops.id),
  recipientPublicKey: text('recipient_public_key'),
  amount: text('amount').notNull(),
  asset: text('asset').notNull(),
  txHash: text('tx_hash').unique(),
  status: text('status').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const gifts = sqliteTable('gifts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  type: text('type').notNull(),
  amount: text('amount').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type TelegramBinding = typeof telegramBindings.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type CoffeeShop = typeof coffeeShops.$inferSelect;
export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
export type AdminStepUpAttempt = typeof adminStepUpAttempts.$inferSelect;
