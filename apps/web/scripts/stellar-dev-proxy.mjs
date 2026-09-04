import http from 'node:http';
import { ProxyAgent, fetch as undiciFetch, setGlobalDispatcher } from 'undici';

const PORT = Number(process.env.STELLAR_DEV_PROXY_PORT ?? 8788);
const HORIZON_URL = process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const FORWARD_PROXY = process.env.STELLAR_DEV_FORWARD_PROXY ?? 'http://localhost:2352';

if (FORWARD_PROXY && FORWARD_PROXY !== 'direct' && FORWARD_PROXY !== 'none') {
  setGlobalDispatcher(new ProxyAgent(FORWARD_PROXY));
}

function serviceBase(service) {
  if (service === 'horizon') return HORIZON_URL;
  if (service === 'soroban') return SOROBAN_RPC_URL;
  return null;
}

function forwardHeaders(req) {
  const headers = {};
  const contentType = req.headers['content-type'];
  const accept = req.headers['accept'];
  if (contentType) headers['content-type'] = contentType;
  if (accept) headers['accept'] = accept;
  return headers;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const [service, ...rest] = url.pathname.split('/').filter(Boolean);
  const base = serviceBase(service);
  if (!base) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  const target = `${base.replace(/\/+$/, '')}/${rest.map(encodeURIComponent).join('/')}${url.search}`;
  const method = req.method ?? 'GET';
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', async () => {
    const body = Buffer.concat(chunks);
    const started = Date.now();
    console.log(`[dev-proxy] ${method} ${target} start`);
    try {
      const upstream = await undiciFetch(target, {
        method,
        headers: forwardHeaders(req),
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
      });
      const text = await upstream.text();
      console.log(`[dev-proxy] ${method} ${target} ok ${upstream.status} (${Date.now() - started}ms)`);
      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
      });
      res.end(text);
    } catch (error) {
      console.error(`[dev-proxy] ${method} ${target} FAILED (${Date.now() - started}ms): ${error}`);
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad_gateway' }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`[dev-proxy] listening on http://localhost:${PORT}`);
  console.log(`[dev-proxy] horizon -> ${HORIZON_URL}`);
  console.log(`[dev-proxy] soroban -> ${SOROBAN_RPC_URL}`);
  console.log(`[dev-proxy] forward proxy: ${FORWARD_PROXY && FORWARD_PROXY !== 'direct' && FORWARD_PROXY !== 'none' ? FORWARD_PROXY : 'none (direct)'}`);
});
