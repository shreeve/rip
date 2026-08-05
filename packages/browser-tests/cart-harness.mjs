// Cart publication apply: real `rip site` on packages/site/demos/cart behind a stub
// Janus edge. API requests proxy to API-only workers; registered roots serve
// App/dist bytes; `/hub` fans out ordered Manager publication changes.
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync,
  statSync, symlinkSync, unlinkSync, writeFileSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const cartSrc = join(root, 'packages/site/demos/cart');
const loaderPath = join(root, 'src/loader.js');
const serverBin = join(root, 'packages/site/site.rip');
const PORT = Number(process.env.CART_HARNESS_PORT || 4174);

const fixtureRoot = mkdtempSync(join(tmpdir(), `rip-cart-harness-${process.pid}-`));
const cartDir = join(fixtureRoot, 'cart');
cpSync(cartSrc, cartDir, { recursive: true });

// Bun resolves @rip-lang/* upward from the app; seed the same workspace
// links the server suite uses so a /tmp cart boots the checkout's packages.
const nm = join(fixtureRoot, 'node_modules', '@rip-lang');
mkdirSync(nm, { recursive: true });
const repoRipLang = join(root, 'node_modules', '@rip-lang');
for (const name of readdirSync(repoRipLang)) {
  const link = join(nm, name);
  try { unlinkSync(link); } catch { /* fresh */ }
  symlinkSync(join(repoRipLang, name), link);
}

const ctlSock = join(fixtureRoot, 'janus.sock');
const calls = [];
const hubClients = new Set();
const hubFrames = [];
let registration = null;

const fanoutChange = (body) => {
  const items = Array.isArray(body) ? body : [body];
  for (const item of items) {
    if (!item?.change) continue;
    const frame = JSON.stringify({ change: item.change });
    hubFrames.push(frame);
    for (const socket of hubClients) {
      try { socket.send(frame); } catch { /* closed */ }
    }
  }
};

const stub = Bun.serve({
  unix: ctlSock,
  fetch: async (rq) => {
    const url = new URL(rq.url);
    if (rq.method === 'GET') return new Response('janus', { status: 404 });
    let body = null;
    if (rq.method === 'POST' || rq.method === 'PUT') {
      body = await rq.json().catch(() => null);
    }
    calls.push({ method: rq.method, path: url.pathname, body });
    if (rq.method === 'POST' && url.pathname === '/1.0/apps') {
      registration = body;
      return Response.json({ id: 'cart-probe' }, { status: 201 });
    }
    if (rq.method === 'PUT' && url.pathname.endsWith('/upstreams')) {
      return Response.json({ ok: true });
    }
    if (rq.method === 'POST' && url.pathname.endsWith('/heartbeat')) {
      return new Response(null, { status: 204 });
    }
    if (rq.method === 'POST' && url.pathname.endsWith('/hub/publish')) {
      fanoutChange(body);
      const n = Array.isArray(body) ? body.length : 1;
      return Response.json({ objects: n, deliveries: n, unknown_targets: 0 });
    }
    if (rq.method === 'DELETE') return new Response(null, { status: 204 });
    return new Response('nope', { status: 404 });
  },
});

// Invoke the manager the same way the server suite does: bun + loader +
// site.rip. `rip site` only resolves when cwd can see rip-site on
// PATH (repo root / linked bins) — a /tmp cart copy cannot.
const manager = Bun.spawn(
  [
    process.execPath, `--preload=${loaderPath}`, serverBin,
    'index.rip', '--control', ctlSock, '--name', 'cart-probe', '-w', '1',
  ],
  {
    cwd: cartDir,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      RIP_ENV: 'development',
      RIP_SETTLE_MS: '60',
      RIP_HEARTBEAT_MS: '200',
      RIP_DRAIN_MS: '100',
      RIP_KILL_MS: '400',
      RIP_HOLD_MS: '8000',
      RIP_BOOT_DEADLINE_MS: '30000',
    },
  },
);

const drain = async (stream, label) => {
  if (!stream) return;
  const reader = stream.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = dec.decode(value);
    if (process.env.CART_HARNESS_LOG) process.stderr.write(`[cart-harness:${label}] ${text}`);
  }
};
drain(manager.stdout, 'out');
drain(manager.stderr, 'err');

const workerSock = async () => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const put = [...calls].reverse().find(
      (c) => c.method === 'PUT' && c.body?.upstreams?.length &&
        !c.body.upstreams.some((u) => u.doorbell),
    );
    const upstreams = put?.body?.upstreams ?? registration?.upstreams;
    const path = upstreams?.find((upstream) => !upstream.doorbell)?.path;
    if (path && existsSync(path)) return path;
    await Bun.sleep(25);
  }
  throw new Error('cart-harness: worker socket never registered');
};

const initialSock = await workerSock();
writeFileSync(join(fixtureRoot, 'ready'), `${initialSock}\n`);

const proxy = async (request) => {
  const url = new URL(request.url);
  const target = `http://uds${url.pathname}${url.search}`;
  const headers = new Headers(request.headers);
  headers.delete('host');
  const init = {
    method: request.method,
    headers,
    unix: await workerSock(),
    duplex: 'half',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
  }
  return fetch(target, init);
};

const contentType = path => {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.rip')) return 'text/plain; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
};

const edgeFile = (pathname, accept) => {
  const relative = pathname.replace(/^\/+/, '');
  for (const root of registration?.files?.roots ?? []) {
    const path = join(root.path, relative);
    try {
      if (!statSync(path).isFile()) continue;
      const cache = root.class === 'live' && path.endsWith('.rip') ? 'no-store' : 'no-cache';
      return new Response(readFileSync(path), { headers: { 'Content-Type': contentType(path), 'Cache-Control': cache } });
    } catch {}
  }
  if (accept?.includes('text/html') && registration?.files?.shell) {
    return new Response(readFileSync(registration.files.shell), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
  }
  return null;
};

const server = Bun.serve({
  port: PORT,
  async fetch(request, srv) {
    const url = new URL(request.url);
    if (url.pathname === '/hub') {
      return srv.upgrade(request) ? undefined : new Response('websocket only', { status: 400 });
    }
    if (url.pathname === '/__test/frames') {
      return Response.json(hubFrames);
    }
    if (url.pathname === '/__test/cart-root') {
      return Response.json({ cartDir, fixtureRoot });
    }
    if (url.pathname === '/__test/ready') {
      return Response.json({ ok: true, sock: await workerSock() });
    }
    if (registration?.files?.proxy_first?.some(prefix => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) {
      return proxy(request);
    }
    return edgeFile(url.pathname, request.headers.get('accept')) ?? new Response('not found', { status: 404 });
  },
  websocket: {
    open(ws) {
      hubClients.add(ws);
    },
    message(ws, text) {
      try {
        const frame = JSON.parse(String(text));
        if (typeof frame?.['?'] === 'string') ws.send(JSON.stringify({ '!': frame['?'] }));
      } catch { /* malformed client test traffic is irrelevant here */ }
    },
    close(ws) { hubClients.delete(ws); },
  },
});

const shutdown = () => {
  try { server.stop(true); } catch { /* */ }
  try { manager.kill('SIGKILL'); } catch { /* */ }
  try { stub.stop(true); } catch { /* */ }
  try { rmSync(fixtureRoot, { recursive: true, force: true }); } catch { /* */ }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => {
  try { manager.kill('SIGKILL'); } catch { /* */ }
  try { stub.stop(true); } catch { /* */ }
  try { rmSync(fixtureRoot, { recursive: true, force: true }); } catch { /* */ }
});

console.log(`cart-harness: http://127.0.0.1:${PORT} (cart → ${cartDir})`);
