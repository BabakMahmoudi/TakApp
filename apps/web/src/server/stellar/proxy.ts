import { logHttp } from '../logging';
import type { WorkerEnv } from '../trpc/env';

export type StellarProxyEnv = Pick<WorkerEnv, 'HORIZON_URL' | 'SOROBAN_RPC_URL'>;

const PROXY_TIMEOUT_MS = 30_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function isRejectedSegment(segment: string): boolean {
  return (
    segment === '' ||
    segment === '.' ||
    segment === '..' ||
    segment.includes('/') ||
    segment.includes('\\') ||
    segment.includes('..')
  );
}

function buildTarget(base: string, segments: string[], search: string): string {
  const encoded = segments.map(encodeURIComponent).join('/');
  const pathname = encoded.length > 0 ? `/${encoded}` : '';
  return `${base}${pathname}${search}`;
}

export async function proxyStellarRequest(
  req: Request,
  path: string[],
  env: StellarProxyEnv,
): Promise<Response> {
  const [service, ...rest] = path;
  if (service !== 'horizon' && service !== 'soroban') {
    return json(404, { error: 'not_found' });
  }
  if (rest.some(isRejectedSegment)) {
    return json(400, { error: 'invalid_path' });
  }

  const base = (service === 'horizon' ? env.HORIZON_URL : env.SOROBAN_RPC_URL).replace(/\/+$/, '');
  const target = buildTarget(base, rest, new URL(req.url).search);

  const headers = new Headers();
  const contentType = req.headers.get('content-type');
  const accept = req.headers.get('accept');
  if (contentType) headers.set('content-type', contentType);
  if (accept) headers.set('accept', accept);

  const method = req.method;
  const body = method === 'GET' || method === 'HEAD' ? undefined : await req.text();

  try {
    const upstream = await logHttp(method, target, () =>
      fetch(target, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      }),
    );
    const responseBody = await upstream.text();
    return new Response(responseBody, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return json(502, { error: 'bad_gateway' });
  }
}
