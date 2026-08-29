import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { WorkerEnv } from './env';

export function getBindings(): WorkerEnv {
  return getCloudflareContext().env as WorkerEnv;
}
