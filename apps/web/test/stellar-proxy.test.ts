import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyStellarRequest, type StellarProxyEnv } from '../src/server/stellar/proxy';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org';
const env: StellarProxyEnv = { HORIZON_URL, SOROBAN_RPC_URL };

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('stellar proxy', () => {
  it('maps a horizon path to the Horizon upstream (GET)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }, 200));
    vi.stubGlobal('fetch', fetchMock);

    const req = new Request('http://localhost/api/stellar/horizon/accounts/GABC?order=desc');
    const response = await proxyStellarRequest(req, ['horizon', 'accounts', 'GABC'], env);

    expect(fetchMock).toHaveBeenCalledWith(
      `${HORIZON_URL}/accounts/GABC?order=desc`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('maps a soroban path to the Soroban RPC base (POST)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ result: 'sim' }, 200));
    vi.stubGlobal('fetch', fetchMock);

    const req = new Request('http://localhost/api/stellar/soroban', { method: 'POST' });
    const response = await proxyStellarRequest(req, ['soroban'], env);

    expect(fetchMock).toHaveBeenCalledWith(
      SOROBAN_RPC_URL,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(response.status).toBe(200);
  });

  it('forwards the POST body and content-type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ hash: 'h' }, 200));
    vi.stubGlobal('fetch', fetchMock);

    const req = new Request('http://localhost/api/stellar/horizon/transactions', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ tx: 'signed-xdr' }),
    });
    await proxyStellarRequest(req, ['horizon', 'transactions'], env);

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toEqual(
      new Headers({ 'content-type': 'application/x-www-form-urlencoded' }),
    );
    expect(await init.body).toBe('tx=signed-xdr');
  });

  it('passes through the upstream status and content-type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: 'boom' }), {
          status: 400,
          headers: { 'content-type': 'application/problem+json' },
        }),
      ),
    );

    const response = await proxyStellarRequest(
      new Request('http://localhost/api/stellar/horizon/transactions', { method: 'POST' }),
      ['horizon', 'transactions'],
      env,
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(await response.json()).toEqual({ detail: 'boom' });
  });

  it('returns 404 for an unknown first segment', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await proxyStellarRequest(
      new Request('http://localhost/api/stellar/other/x'),
      ['other', 'x'],
      env,
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['..', '.', ''])('returns 400 for a traversal/empty segment %j', async (segment) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await proxyStellarRequest(
      new Request('http://localhost/api/stellar/horizon/x'),
      ['horizon', segment],
      env,
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 502 when the upstream fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const response = await proxyStellarRequest(
      new Request('http://localhost/api/stellar/horizon/accounts/GABC'),
      ['horizon', 'accounts', 'GABC'],
      env,
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'bad_gateway' });
  });
});
