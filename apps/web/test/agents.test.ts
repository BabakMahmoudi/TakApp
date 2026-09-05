import { describe, expect, it, vi } from 'vitest';
import type { User } from '@takapp/shared/db';
import { appRouter } from '../src/server/trpc/router';
import type { TrpcContext } from '../src/server/trpc/context';
import { buildCaller, errorCode, testEnv } from './helpers/caller';
import { MockDb, type MockDbTable } from './helpers/mock-db';

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: unknown, value: unknown) => ({ kind: 'eq', column, value }),
    and: (...conds: unknown[]) => ({ kind: 'and', conds }),
    desc: (column: unknown) => ({ kind: 'desc', column }),
  };
});

const USER_A = `G${'A'.repeat(55)}`;
const USER_B = `G${'B'.repeat(55)}`;

function user(id: number, publicKey: string): User {
  return {
    id,
    stellarPublicKey: publicKey,
    email: `user${id}@example.com`,
    phone: null,
    displayName: `User ${id}`,
    passwordHash: 'pbkdf2$SHA-256$i=100000$abc$def',
    verificationState: 'verified',
    role: 'user',
    totpSecret: null,
    createdAt: new Date(),
  };
}

function conversation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    userId: 1,
    anonymousKey: null,
    agentId: 'takapp-agent',
    memoryId: 'mem-1',
    title: null,
    createdAt: new Date(),
    lastMessageAt: new Date(),
    ...overrides,
  };
}

function makeDb() {
  const tables: Record<string, MockDbTable> = {
    users: { rows: [user(1, USER_A), user(2, USER_B)] },
    agent_conversations: { rows: [], unique: ['memoryId'] },
  };
  return new MockDb(tables);
}

function anonymousCaller(db: MockDb, anonymousKey?: string) {
  const headers: Record<string, string> = {};
  if (anonymousKey) headers['x-anonymous-key'] = anonymousKey;
  const context: TrpcContext = {
    db: db as unknown as TrpcContext['db'],
    env: testEnv,
    req: new Request('http://localhost', { headers }),
    reqId: 'test',
  };
  return appRouter.createCaller(context);
}

describe('agents.create', () => {
  it('creates a conversation owned by the authed user', async () => {
    const db = makeDb();
    const caller = await buildCaller(db, USER_A);
    const created = await caller.agents.create({ agentId: 'takapp-agent' });
    expect(created.memoryId).toBeTruthy();
    expect(db.table('agent_conversations').rows[0]).toMatchObject({
      userId: 1,
      agentId: 'takapp-agent',
    });
  });

  it('creates an anonymous conversation from the device key', async () => {
    const db = makeDb();
    const caller = anonymousCaller(db, 'anon-1');
    await caller.agents.create({ agentId: 'takapp-agent' });
    expect(db.table('agent_conversations').rows[0]).toMatchObject({
      anonymousKey: 'anon-1',
      userId: null,
    });
  });

  it('rejects creation without auth or a device key', async () => {
    const db = makeDb();
    const caller = anonymousCaller(db);
    expect(await errorCode(caller.agents.create({ agentId: 'takapp-agent' }))).toBe('BAD_REQUEST');
  });
});

describe('agents.list', () => {
  it('lists only the caller conversations', async () => {
    const db = makeDb();
    db.table('agent_conversations').rows = [
      conversation({ id: 1, userId: 1, memoryId: 'mem-1' }),
      conversation({ id: 2, userId: 2, memoryId: 'mem-2' }),
    ];
    const caller = await buildCaller(db, USER_A);
    const { conversations } = await caller.agents.list();
    expect(conversations).toHaveLength(1);
    expect(conversations[0]!.memoryId).toBe('mem-1');
  });

  it('lists anonymous conversations by device key', async () => {
    const db = makeDb();
    db.table('agent_conversations').rows = [
      conversation({ id: 1, userId: null, anonymousKey: 'anon-1', memoryId: 'mem-anon' }),
    ];
    const caller = anonymousCaller(db, 'anon-1');
    const { conversations } = await caller.agents.list();
    expect(conversations).toHaveLength(1);
    expect(conversations[0]!.memoryId).toBe('mem-anon');
  });
});

describe('agents tenancy', () => {
  it('denies deleting another user conversation', async () => {
    const db = makeDb();
    db.table('agent_conversations').rows = [conversation({ id: 5, userId: 2, memoryId: 'mem-2' })];
    const caller = await buildCaller(db, USER_A);
    expect(await errorCode(caller.agents.delete({ id: 5 }))).toBe('NOT_FOUND');
    expect(db.table('agent_conversations').rows).toHaveLength(1);
  });

  it('denies renaming another user conversation', async () => {
    const db = makeDb();
    db.table('agent_conversations').rows = [conversation({ id: 5, userId: 2, memoryId: 'mem-2' })];
    const caller = await buildCaller(db, USER_A);
    expect(await errorCode(caller.agents.rename({ id: 5, title: 'stolen' }))).toBe('NOT_FOUND');
    expect(db.table('agent_conversations').rows[0]!.title).toBeNull();
  });

  it('renames the caller own conversation', async () => {
    const db = makeDb();
    db.table('agent_conversations').rows = [conversation({ id: 5, userId: 1, memoryId: 'mem-1' })];
    const caller = await buildCaller(db, USER_A);
    await caller.agents.rename({ id: 5, title: 'My coffee chat' });
    expect(db.table('agent_conversations').rows[0]!.title).toBe('My coffee chat');
  });
});
