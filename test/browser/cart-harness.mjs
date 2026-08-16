// Cart publication apply: real `rip site` on packages/sites/demos/cart behind a stub
// Janus edge. API requests proxy to API-only workers; registered roots serve
// App/dist bytes; `/hub` fans out ordered Manager publication changes.
import {
  cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const cartSrc = join(root, 'packages/sites/demos/cart');
const loaderPath = join(root, 'src/loader.js');
// Manager entry — `site.rip` is the Sites framework library (not a CLI).
const serverBin = join(root, 'packages/sites/manager.rip');
const PORT = Number(process.env.CART_HARNESS_PORT || 4174);

const fixtureRoot = mkdtempSync(join(tmpdir(), `rip-cart-harness-${process.pid}-`));
const cartDir = join(fixtureRoot, 'cart');
cpSync(cartSrc, cartDir, { recursive: true });

// The cart imports `rip/*` — the loader's stdlib namespace resolves
// them from this checkout, so a /tmp cart needs no node_modules.

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
  idleTimeout: 120,
  fetch: async (rq) => {
    const url = new URL(rq.url);
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
      if (registration && body?.upstreams) {
        registration = { ...registration, upstreams: body.upstreams };
      }
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
    // Access-log GETs are not part of this harness; manager is started with
    // --access-log=off. Anything else on the control plane is unknown.
    return new Response('nope', { status: 404 });
  },
});

// Real Janus load-balances across worker upstreams. This stub must too:
// Cart stash fetches user/products/orders in parallel, and each worker
// defaults to concurrency 1. App-only watch matches this suite (it edits
// app/ files) and avoids API-pool swaps that briefly drop every socket.
const WORKERS = 4;

// Invoke the manager the same way the sites suite does: bun + loader +
// site.rip. `rip site` only resolves when cwd can see rip-site on
// PATH (repo root / linked bins) — a /tmp cart copy cannot.
const manager = Bun.spawn(
  [
    process.execPath, `--preload=${loaderPath}`, serverBin,
    'index.rip', '--control', ctlSock, '--name', 'cart-probe',
    '-w', String(WORKERS), '--watch-app', '--no-watch-api', '--access-log=off',
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
      RIP_BOOT_DEADLINE_MS: process.env.CI ? '55000' : '30000',
    },
  },
);

const mirrorManager = process.env.CART_HARNESS_LOG || process.env.CI;
const drain = async (stream, label) => {
  if (!stream) return;
  const reader = stream.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = dec.decode(value);
    if (mirrorManager) process.stderr.write(`[cart-harness:${label}] ${text}`);
  }
};
drain(manager.stdout, 'out');
drain(manager.stderr, 'err');

const liveUpstreams = () => {
  // Latest upstream PUT wins, including lists that also carry a doorbell —
  // skip only the doorbell entries, not the whole PUT.
  let upstreams = registration?.upstreams ?? [];
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    if (c.method === 'PUT' && Array.isArray(c.body?.upstreams)) {
      upstreams = c.body.upstreams;
      break;
    }
  }
  return upstreams
    .filter((u) => u && !u.doorbell && u.path && existsSync(u.path))
    .map((u) => u.path);
};

let rr = 0;
const workerSock = async ({ need = 1 } = {}) => {
  // CI runners are slower to spawn the manager + worker pool than a laptop.
  const deadline = Date.now() + (process.env.CI ? 55000 : 30000);
  while (Date.now() < deadline) {
    if (manager.exitCode != null) {
      throw new Error(`cart-harness: manager exited ${manager.exitCode} before registering workers`);
    }
    const paths = liveUpstreams();
    if (paths.length >= need) {
      const path = paths[rr % paths.length];
      rr += 1;
      return path;
    }
    await Bun.sleep(25);
  }
  throw new Error(`cart-harness: only ${liveUpstreams().length}/${need} worker sockets registered`);
};

// Wait for the full pool so the first parallel stash fetches do not stampede
// a single upstream before siblings appear.
const initialSock = await workerSock({ need: WORKERS });
writeFileSync(join(fixtureRoot, 'ready'), `${initialSock}\n`);
// Playwright only needs a 2xx on /__test/ready after boot.
let readySock = initialSock;
let booted = true;

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
  idleTimeout: 120,
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
      const paths = liveUpstreams();
      if (paths.length) {
        readySock = paths[rr % paths.length];
        return Response.json({ ok: true, sock: readySock, workers: paths.length });
      }
      // After first boot, a brief empty pool must not fail Playwright's probe.
      if (booted) return Response.json({ ok: true, sock: readySock, workers: 0 });
      readySock = await workerSock({ need: 1 });
      return Response.json({ ok: true, sock: readySock });
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
