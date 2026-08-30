import type { D1Database } from '@cloudflare/workers-types';

const MAX_PROP_VALUE = 500;
const MAX_OBJECT = 1000;

function safeStringify(value: unknown, seen: Set<unknown>): string {
  switch (typeof value) {
    case 'undefined':
      return 'undefined';
    case 'string':
      return JSON.stringify(value.length > MAX_PROP_VALUE ? `${value.slice(0, MAX_PROP_VALUE)}…` : value);
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    case 'symbol':
      return String(value);
    case 'function':
      return '[function]';
    case 'object': {
      if (value === null) return 'null';
      if (seen.has(value)) return '[circular]';
      seen.add(value);
      try {
        const json = JSON.stringify(value);
        if (json !== undefined) return json.length > MAX_OBJECT ? `${json.slice(0, MAX_OBJECT)}…` : json;
      } catch {
        // circular or a toJSON that throws; fall through to key enumeration
      }
      try {
        const keys = Object.keys(value as object);
        const shown = keys.slice(0, 10).map((key) => `${key}: ${safeStringify((value as Record<string, unknown>)[key], seen)}`);
        if (keys.length > 10) shown.push('…');
        return `{ ${shown.join(', ')} }`;
      } catch {
        return '[unserializable object]';
      }
    }
  }
}

export function serializeError(err: unknown): string {
  try {
    if (err instanceof Error) {
      const parts = [`${err.name}: ${err.message}`];
      const seen = new Set<unknown>([err]);
      const ownProps = Object.keys(err)
        .filter((key) => key !== 'cause')
        .map((key) => `${key}=${safeStringify((err as unknown as Record<string, unknown>)[key], seen)}`);
      if (ownProps.length > 0) parts.push(`props: { ${ownProps.join(', ')} }`);
      if (err.stack) parts.push(`stack: ${err.stack}`);
      const causeParts: string[] = [];
      let cause: unknown = (err as { cause?: unknown }).cause;
      while (cause && !seen.has(cause)) {
        seen.add(cause);
        causeParts.push(cause instanceof Error ? `${cause.name}: ${cause.message}` : safeStringify(cause, seen));
        cause = (cause as { cause?: unknown }).cause;
      }
      if (causeParts.length > 0) parts.push(`cause: ${causeParts.join(' -> ')}`);
      return parts.join(' | ');
    }
    return safeStringify(err, new Set());
  } catch {
    return `[unserializable error: ${String(err)}]`;
  }
}

export function reqId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export async function logStep<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  console.log(`[signup] ${label} start`);
  try {
    const result = await fn();
    console.log(`[signup] ${label} ok (${Date.now() - started}ms)`);
    return result;
  } catch (error) {
    console.error(`[signup] ${label} FAILED after ${Date.now() - started}ms: ${serializeError(error)}`);
    throw error;
  }
}

export async function logHttp(method: string, url: string, fn: () => Promise<Response>): Promise<Response> {
  const started = Date.now();
  console.log(`[http] ${method} ${url} start`);
  try {
    const response = await fn();
    console.log(`[http] ${method} ${url} ok ${response.status} (${Date.now() - started}ms)`);
    return response;
  } catch (error) {
    console.error(`[http] ${method} ${url} FAILED (${Date.now() - started}ms): ${serializeError(error)}`);
    throw error;
  }
}

let d1ProbeResult: { ok: boolean; durationMs: number } | null = null;

export async function d1Probe(db: D1Database): Promise<{ ok: boolean; durationMs: number }> {
  if (d1ProbeResult) return d1ProbeResult;
  const started = Date.now();
  try {
    await db.prepare('SELECT 1').first();
    d1ProbeResult = { ok: true, durationMs: Date.now() - started };
    console.log(`[d1] probe ok (${d1ProbeResult.durationMs}ms)`);
  } catch (error) {
    d1ProbeResult = { ok: false, durationMs: Date.now() - started };
    console.error(`[d1] probe FAILED (${d1ProbeResult.durationMs}ms): ${serializeError(error)}`);
  }
  return d1ProbeResult;
}
