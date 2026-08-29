import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '@takapp/shared/db';
import type { WorkerEnv } from './env';

export interface TrpcContext {
  db: ReturnType<typeof drizzle<typeof schema>>;
  env: WorkerEnv;
  req: Request;
}

export function createContext(opts: FetchCreateContextFnOptions, env: WorkerEnv): TrpcContext {
  const db = drizzle(env.DB, { schema });
  return { db, env, req: opts.req };
}
