import { existsSync, mkdirSync, statSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { spawn } from 'bun';
import { RipPlatform, type AppConfig } from './platform';
import { RipManager } from './manager';
import { RipServer } from './server';

// HTTPS/CA Configuration
const RIP_CONFIG_DIR = join(homedir(), '.rip-server');
const CA_DIR = join(RIP_CONFIG_DIR, 'ca');
const CERTS_DIR = join(RIP_CONFIG_DIR, 'certs');
const RUN_DIR = join(RIP_CONFIG_DIR, 'run');

// Configuration defaults
const defaults = {
  mode: 'dev',
  httpPort: 3000,
  httpsPort: 3443,
  workers: 3,
  requests: 100,
  appDir: process.cwd(),
  protocol: 'http' as 'http' | 'https' | 'http+https',
  httpsMode: 'smart' as 'smart' | 'quick' | 'ca',
};

// Flexible argument parsing interface
interface Config {
  command?: string;
  mode?: string;
  appDir?: string;
  httpPort?: number;
  httpsPort?: number;
  certPath?: string;
  keyPath?: string;
  workers?: number;
  requests?: number;
  protocol?: 'http' | 'https' | 'http+https';
  httpsMode?: 'smart' | 'quick' | 'ca';
  json?: boolean;
  jsonLogging?: boolean;
}

// ===== FLEXIBLE ARGUMENT PARSING =====
/**
 * Revolutionary flexible argument parser - arguments can be provided in ANY order!
 *
 * Examples:
 *   bun server w:5 8080 apps/labs/api         # Workers, port, directory
 *   bun server apps/labs/api prod w:10        # Directory, mode, workers
 *   bun server deploy test-app w:3 examples/hello  # Deploy with flexible args
 *
 * Smart Detection:
 *   - w:5, r:100          → Worker/request counts
 *   - 8080, 3443          → Port numbers
 *   - apps/labs/api       → Directory paths
 *   - dev, prod           → Modes
 *   - https:ca, https:quick → HTTPS modes
 *   - cert.pem, key.pem   → Certificate files
 *   - --json, -h          → Flags
 */
function parseArgs(args: string[]): Config {
  const config: Config = {};
  const commands = [
    'dev',
    'prod',
    'start',
    'stop',
    'status',
    'test',
    'help',
    '-h',
    '--help',
    'ca:init',
    'ca:trust',
    'ca:export',
    'ca:info',
    'ca:list',
    'ca:clean',
    // Platform commands
    'platform',
    'deploy',
    'undeploy',
    'list',
    'scale',
    'restart',
  ];

  // Handle help flags first (before modifying args)
  if (args.includes('--help') || args.includes('-h')) {
    config.command = 'help';
    return config;
  }

  // Copy args to avoid modifying the original
  let remainingArgs = [...args];

  // First, check for command
  if (remainingArgs.length > 0 && commands.includes(remainingArgs[0])) {
    config.command = remainingArgs[0];
    remainingArgs = remainingArgs.slice(1);
  }

  // Separate cert/key files from other args
  const certFiles: string[] = [];
  const otherArgs: string[] = [];

  for (const arg of remainingArgs) {
    // Check for cert/key files
    if (
      arg.endsWith('.pem') ||
      arg.endsWith('.crt') ||
      arg.endsWith('.key') ||
      arg.endsWith('.cert')
    ) {
      if (existsSync(arg)) {
        certFiles.push(arg);
      }
    } else {
      otherArgs.push(arg);
    }
  }

  // Process cert files (need exactly 2)
  if (certFiles.length === 2) {
    // Try to identify which is cert and which is key
    const [file1, file2] = certFiles;
    if (file1.includes('key') || file2.includes('cert')) {
      config.keyPath = file1;
      config.certPath = file2;
    } else if (file2.includes('key') || file1.includes('cert')) {
      config.certPath = file1;
      config.keyPath = file2;
    } else {
      // Default assumption: first is cert, second is key
      config.certPath = file1;
      config.keyPath = file2;
    }
  }

  // Process remaining arguments
  for (const arg of otherArgs) {
    // JSON output flag
    if (arg === '--json' || arg === '-j') {
      config.json = true;
      continue;
    }

    // JSON logging flag
    if (arg === '--json-logging') {
      config.jsonLogging = true;
      continue;
    }

    // Worker count: w:5
    if (arg.match(/^w:\d+$/)) {
      config.workers = Number.parseInt(arg.substring(2));
      continue;
    }

    // Request count: r:100
    if (arg.match(/^r:\d+$/)) {
      config.requests = Number.parseInt(arg.substring(2));
      continue;
    }

    // Port number (1-65535)
    const port = Number.parseInt(arg);
    if (!Number.isNaN(port) && port >= 1 && port <= 65535) {
      // If HTTPS is configured, this is HTTPS port, otherwise HTTP
      if (config.certPath && config.keyPath) {
        config.httpsPort = port;
      } else {
        config.httpPort = port;
      }
      continue;
    }

    // Directory path
    if (arg.startsWith('/') || arg.startsWith('./') || arg.startsWith('../')) {
      const resolved = resolve(arg);
      if (existsSync(resolved)) {
        config.appDir = resolved;
        continue;
      }
    }

    // Check if it's an existing directory
    const resolved = resolve(arg);
    if (existsSync(resolved) && statSync(resolved).isDirectory()) {
      config.appDir = resolved;
      continue;
    }

    // Mode (dev/prod)
    if (arg === 'dev' || arg === 'prod') {
      config.mode = arg;
      continue;
    }

    // Protocol specifiers
    if (arg === 'http' || arg === 'https' || arg === 'http+https') {
      config.protocol = arg;
      continue;
    }

    // HTTPS mode specifiers
    if (arg === 'https:quick' || arg === 'https:ca' || arg === 'https:smart') {
      config.protocol = 'https';
      config.httpsMode = arg.split(':')[1] as 'quick' | 'ca' | 'smart';
    }
  }

  return config;
}

// Load configuration from files
async function loadFileConfig(appDir: string): Promise<Partial<Config>> {
  const config: Partial<Config> = {};

  // Try package.json
  const packagePath = join(appDir, 'package.json');
  if (existsSync(packagePath)) {
    try {
      const pkg = await Bun.file(packagePath).json();
      if (pkg['rip-server']) {
        Object.assign(config, pkg['rip-server']);
      }
    } catch {}
  }

  // Try bunfig.toml
  const bunfigPath = join(appDir, 'bunfig.toml');
  if (existsSync(bunfigPath)) {
    try {
      const bunfig = await Bun.file(bunfigPath).text();
      // Simple extraction for rip-server section
      const match = bunfig.match(/\[rip-server\]([\s\S]*?)(?:\n\[|$)/);
      if (match) {
        const section = match[1];
        // Extract simple key = value pairs
        const workers = section.match(/workers\s*=\s*(\d+)/);
        const requests = section.match(/requests\s*=\s*(\d+)/);
        const httpPort = section.match(/httpPort\s*=\s*(\d+)/);
        const httpsPort = section.match(/httpsPort\s*=\s*(\d+)/);

        if (workers) config.workers = Number.parseInt(workers[1]);
        if (requests) config.requests = Number.parseInt(requests[1]);
        if (httpPort) config.httpPort = Number.parseInt(httpPort[1]);
        if (httpsPort) config.httpsPort = Number.parseInt(httpsPort[1]);
      }
    } catch {}
  }

  return config;
}

async function isRunning(): Promise<boolean> {
  try {
    // Check any direct-mode pid files and probe ports
    if (existsSync(RUN_DIR)) {
      const files = readdirSync(RUN_DIR).filter(f => f.startsWith('direct-') && f.endsWith('.pid'));
      for (const f of files) {
        try {
          const meta = JSON.parse(readFileSync(join(RUN_DIR, f), 'utf8')) as any;
          const probes: string[] = [];
          if (meta.httpPort) probes.push(`http://localhost:${meta.httpPort}/health`);
          if (meta.httpsPort) probes.push(`https://localhost:${meta.httpsPort}/health`);
          for (const u of probes) {
            const res = await fetch(u, { signal: AbortSignal.timeout(600), redirect: 'manual' as any }).catch(() => null);
            if (res && res.ok) return true;
          }
        } catch {}
      }
    }
    // Fallback to platform default
    const response = await fetch('http://localhost:3000/health', {
      signal: AbortSignal.timeout(800)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function showStatus(): Promise<void> {
  ensureDirectories();
  const json = process.argv.includes('--json') || process.argv.includes('-j');
  const results: any[] = [];
  if (existsSync(RUN_DIR)) {
    const files = readdirSync(RUN_DIR).filter(f => f.startsWith('direct-') && f.endsWith('.pid'));
    for (const f of files) {
      try {
        const meta = JSON.parse(readFileSync(join(RUN_DIR, f), 'utf8')) as any;
        const probes: { url: string; ok: boolean }[] = [];
        if (meta.httpPort) {
          const url = `http://localhost:${meta.httpPort}/health`;
          const res = await fetch(url).catch(() => null);
          probes.push({ url, ok: !!res?.ok });
        }
        if (meta.httpsPort) {
          const url = `https://localhost:${meta.httpsPort}/health`;
          const res = await fetch(url).catch(() => null);
          probes.push({ url, ok: !!res?.ok });
        }
        results.push({ mode: 'direct', ...meta, probes });
      } catch {}
    }
  }

  // Platform probe(s) from pid files (supports custom ports)
  try {
    if (existsSync(RUN_DIR)) {
      const pids = readdirSync(RUN_DIR).filter(f => f.startsWith('platform-') && f.endsWith('.pid'));
      for (const f of pids) {
        try {
          const meta = JSON.parse(readFileSync(join(RUN_DIR, f), 'utf8')) as any;
          const url = `http://localhost:${meta.port}/health`;
          const res = await fetch(url).catch(() => null);
          results.push({ mode: 'platform', port: meta.port, ok: !!res?.ok });
        } catch {}
      }
    }
  } catch {}

  if (json) {
    const anyOk = results.some(r => r.ok !== false);
    const payload = {
      status: results.length ? (anyOk ? 'running' : 'degraded') : 'stopped',
      processes: results.map(r => ({
        mode: r.mode,
        app: r.app,
        pid: r.pid,
        port: r.port,
        httpPort: r.httpPort,
        httpsPort: r.httpsPort,
        workers: r.workers,
        requests: r.requests,
        startedAt: r.startedAt,
        ok: r.ok,
        probes: r.probes,
      })),
    };
    console.log(JSON.stringify(payload, null, 2));
    process.exitCode = payload.status === 'stopped' ? 3 : 0;
  } else {
    if (!results.length) {
      console.log('❌ No running Rip servers found');
      process.exitCode = 3;
      return;
    }
    console.log('🔍 Rip Server Status');
    for (const p of results) {
      if (p.mode === 'direct') {
        console.log(`✅ direct:${p.app} pid=${p.pid} workers=${p.workers} reqs=${p.requests}`);
        for (const pr of p.probes) {
          console.log(`   ${pr.ok ? '🌐' : '⚠️ '} ${pr.url}`);
        }
      } else if (p.mode === 'platform') {
        console.log(`✅ platform: http://localhost:${p.port}`);
      }
    }
  }
}

async function stopServer(force = false, target?: string): Promise<void> {
  ensureDirectories();
  console.log('🛑 Stopping Rip Server(s)...');
  let stopped = 0;
  // Direct mode stops
  if (existsSync(RUN_DIR)) {
    const files = readdirSync(RUN_DIR).filter(f => f.startsWith('direct-') && f.endsWith('.pid'));
    for (const f of files) {
      try {
        const meta = JSON.parse(readFileSync(join(RUN_DIR, f), 'utf8')) as any;
        if (target && target !== meta.app) continue;
        try { process.kill(meta.pid, 'SIGTERM'); stopped++; } catch {}
        try { unlinkSync(join(RUN_DIR, f)); } catch {}
      } catch {}
    }
  }
  // Platform stop via API
  try {
    // If target specifies platform, stop only that port; otherwise all platform pidfiles
    const platformPidfiles = existsSync(RUN_DIR)
      ? readdirSync(RUN_DIR).filter(f => f.startsWith('platform-') && f.endsWith('.pid'))
      : [];
    for (const f of platformPidfiles) {
      try {
        const meta = JSON.parse(readFileSync(join(RUN_DIR, f), 'utf8')) as any;
        const matchesTarget = !target
          || target === 'platform'
          || target === `platform:${meta.port}`
          || target === String(meta.port);
        if (!matchesTarget) continue;
        const res = await fetch(`http://localhost:${meta.port}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(1500) }).catch(() => null);
        if (res?.ok) {
          stopped++;
        } else if (force) {
          try { process.kill(meta.pid, 'SIGTERM'); stopped++; } catch {}
        }
        try { unlinkSync(join(RUN_DIR, f)); } catch {}
      } catch {}
    }
  } catch {}
  // Force mode: attempt to free common ports if still in use
  if (stopped === 0 && force) {
    const killOnPort = async (port: number) => {
      try {
        const p = Bun.spawn(['lsof', '-ti', `tcp:${port}`], { stdout: 'pipe', stderr: 'ignore' });
        const out = await new Response(p.stdout).text();
        const pids = out.split(/\s+/).filter(Boolean);
        for (const pid of pids) {
          try { process.kill(Number(pid), 'SIGTERM'); stopped++; } catch {}
        }
      } catch {}
    };
    const killByTitle = async (titleMatch: string) => {
      try {
        // macOS: ps -A -o pid,comm | grep <title>
        const proc = Bun.spawn(['bash', '-lc', `ps -A -o pid,command | grep "${titleMatch}" | grep -v grep | awk '{print $1}'`], { stdout: 'pipe', stderr: 'ignore' });
        const out = await new Response(proc.stdout).text();
        const pids = out.split(/\s+/).filter(Boolean);
        for (const pid of pids) {
          try { process.kill(Number(pid), 'SIGTERM'); stopped++; } catch {}
        }
      } catch {}
    };
    // Common ports; if target is numeric, prefer that
    const ports: number[] = [];
    if (target && /^\d+$/.test(target)) ports.push(Number(target));
    ports.push(3000, 3443);
    const seen = new Set<number>();
    for (const p of ports) {
      if (seen.has(p)) continue; seen.add(p);
      await killOnPort(p);
    }
    await killByTitle('rip-worker-');
    await killByTitle('rip-server');
  }
  if (stopped === 0) {
    console.log('⚠️  No running servers found');
    process.exitCode = 1;
  } else {
    console.log(`✅ Stopped ${stopped} server${stopped > 1 ? 's' : ''}`);
  }
}

async function startServer(appPath: string, config?: Config): Promise<void> {
  ensureDirectories();
  const absoluteAppPath = resolve(appPath);
  const indexPath = join(absoluteAppPath, 'index.rip');
  if (!existsSync(indexPath)) {
    console.error(`❌ No index.rip found in ${appPath}`);
    process.exit(1);
  }

  const appName = absoluteAppPath.split('/').filter(Boolean).slice(-1)[0] || 'app';
  const workers = config?.workers ?? defaults.workers;
  const requests = config?.requests ?? defaults.requests;
  const protocol = config?.protocol ?? 'http';
  let httpPort = config?.httpPort ?? defaults.httpPort;
  const httpsPort = config?.httpsPort ?? defaults.httpsPort;
  const jsonLogging = !!config?.jsonLogging;

  console.log(`📁 App: ${absoluteAppPath}`);
  console.log(`👥 Workers: ${workers}  🔁 Requests/worker: ${requests}`);
  console.log(`🌐 Protocol: ${protocol}  HTTP:${protocol !== 'https' ? httpPort : '-'}  HTTPS:${protocol !== 'http' ? httpsPort : '-'}`);

  // Resolve TLS material for direct mode if needed
  let httpsConfig: { httpsPort: number; cert: string; key: string } | undefined;
  if (protocol === 'https' || protocol === 'http+https') {
    let certText: string | undefined;
    let keyText: string | undefined;

    if (config?.certPath && config?.keyPath && existsSync(config.certPath) && existsSync(config.keyPath)) {
      try {
        certText = await Bun.file(config.certPath).text();
        keyText = await Bun.file(config.keyPath).text();
      } catch {}
    }

    if (!certText || !keyText) {
      const mode = config?.httpsMode ?? 'smart';
      if (mode === 'quick') {
        const { cert, key } = await generateSelfSignedCert();
        certText = cert; keyText = key;
      } else if (mode === 'ca') {
        const { cert, key } = await generateCACert('localhost');
        certText = cert; keyText = key;
      } else {
        // smart: prefer CA if exists, else quick
        if (hasCA()) {
          const { cert, key } = await generateCACert('localhost');
          certText = cert; keyText = key;
        } else {
          const { cert, key } = await generateSelfSignedCert();
          certText = cert; keyText = key;
        }
      }
    }

    if (certText && keyText) {
      httpsConfig = { httpsPort, cert: certText, key: keyText };
    } else {
      console.warn('⚠️  HTTPS requested but certificate material missing; continuing without HTTPS');
    }
  }

  // Avoid trivial HTTP port conflicts by probing /health and bumping port
  if (protocol !== 'https') {
    for (let i = 0; i < 20; i++) {
      let ok = false;
      try {
        const res = await fetch(`http://localhost:${httpPort}/health`, { signal: AbortSignal.timeout(300) });
        ok = res.ok;
      } catch {}
      if (!ok) break;
      console.warn(`⚠️  Port ${httpPort} appears in use; trying ${httpPort + 1}`);
      httpPort++;
    }
  }

  // Start manager and workers
  const manager = new RipManager();
  await manager.startApp(appName, absoluteAppPath, workers, requests, jsonLogging);

  // Start load balancer server
  const lbHttpPort = protocol === 'https' ? null : httpPort;
  const server = new RipServer(lbHttpPort as any, appName, workers, httpsConfig, jsonLogging);
  await server.start();

  // Print endpoint summary
  const endpoints: string[] = [];
  if (lbHttpPort) endpoints.push(`http://localhost:${lbHttpPort}`);
  if (httpsConfig) endpoints.push(`https://localhost:${httpsConfig.httpsPort}`);
  console.log(`✅ Running: ${endpoints.join('  ')}`);

  // Write pid file for status/stop
  const pidFile = join(RUN_DIR, `direct-${appName}.pid`);
  writeFileSync(pidFile, JSON.stringify({ pid: process.pid, app: appName, httpPort: lbHttpPort, httpsPort: httpsConfig?.httpsPort, workers, requests, startedAt: Date.now() }));

  // Graceful shutdown
  const shutdown = async () => {
    try {
      await server.stop();
    } catch {}
    try {
      await manager.stopApp(appName);
    } catch {}
    try {
      unlinkSync(pidFile);
    } catch {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Global platform instance
let platformInstance: RipPlatform | null = null;

async function startPlatform(port = 3000): Promise<void> {
  console.log('🚀 Starting Rip Platform Controller...');

  platformInstance = new RipPlatform(port);

  // Create platform server with API and dashboard
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      // Health check
      if (url.pathname === '/health') {
        return new Response('{"status":"ok","mode":"platform"}', {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Platform API
      if (url.pathname.startsWith('/api/')) {
        return handlePlatformAPI(req, url);
      }

      // Platform dashboard
      if (url.pathname === '/platform' || url.pathname === '/') {
        return new Response(getPlatformDashboard(), {
          headers: { 'Content-Type': 'text/html' }
        });
      }

      // Shutdown endpoint
      if (url.pathname === '/shutdown' && req.method === 'POST') {
        try { unlinkSync(join(RUN_DIR, `platform-${port}.pid`)); } catch {}
        setTimeout(() => process.exit(0), 100);
        return new Response('Platform shutting down...');
      }

      // If no specific route matches, redirect to platform dashboard
      if (url.pathname === '/') {
        return new Response(null, {
          status: 302,
          headers: { Location: '/platform' }
        });
      }

      return new Response('Platform Controller - No app running', { status: 404 });
    }
  });

  console.log(`✅ Platform Controller running at http://localhost:${port}`);
  console.log(`📊 Dashboard: http://localhost:${port}/platform`);
  console.log(`🔧 API: http://localhost:${port}/api`);
  console.log('🎯 Press Ctrl+C to stop');

  // Write pid file for platform
  ensureDirectories();
  try {
    const pidFile = join(RUN_DIR, `platform-${port}.pid`);
    writeFileSync(pidFile, JSON.stringify({ pid: process.pid, port, startedAt: Date.now() }));
  } catch {}
}

async function handlePlatformAPI(req: Request, url: URL): Promise<Response> {
  if (!platformInstance) {
    return new Response('{"error":"Platform not initialized"}', {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // GET /api/apps - List apps (with port health hints)
    if (url.pathname === '/api/apps' && req.method === 'GET') {
      const apps = platformInstance.listApps();
      const withHealth = await Promise.all(apps.map(async (app) => {
        let httpOk: boolean | null = null;
        let httpsOk: boolean | null = null;
        // HTTP health probe
        if (app.protocol !== 'https' && app.port) {
          try {
            const res = await fetch(`http://localhost:${app.port}/health`, { signal: AbortSignal.timeout(400) });
            httpOk = !!res.ok;
          } catch {
            httpOk = false;
          }
        }
        // HTTPS health probe (best effort; may be null if self-signed)
        if ((app.protocol === 'https' || app.protocol === 'http+https') && app.httpsPort) {
          try {
            const res = await fetch(`https://localhost:${app.httpsPort}/health`, { signal: AbortSignal.timeout(400) });
            httpsOk = !!res.ok;
          } catch {
            httpsOk = false;
          }
        }
        return { ...app, httpOk, httpsOk } as any;
      }));
      return new Response(JSON.stringify(withHealth, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // GET /api/stats - Platform stats
    if (url.pathname === '/api/stats' && req.method === 'GET') {
      const stats = platformInstance.getStats();
      return new Response(JSON.stringify(stats, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // POST /api/apps - Deploy app
    if (url.pathname === '/api/apps' && req.method === 'POST') {
      const body = await req.json() as { name: string; directory: string; workers?: number; port?: number; protocol?: 'http'|'https'|'http+https'; httpsPort?: number; cert?: string; key?: string; jsonLogging?: boolean; requests?: number };
      const app = await platformInstance.deployApp(
        body.name,
        body.directory,
        body.workers ?? 3,
        body.port,
        body.protocol,
        body.httpsPort,
        body.cert,
        body.key,
        body.jsonLogging,
        body.requests,
      );
      // Auto-start app after deploy
      try { await platformInstance.startApp(body.name); } catch {}
      return new Response(JSON.stringify(app, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // DELETE /api/apps/:name - Undeploy app
    const undeployMatch = url.pathname.match(/^\/api\/apps\/([^\/]+)$/);
    if (undeployMatch && req.method === 'DELETE') {
      const name = undeployMatch[1];
      await platformInstance.undeployApp(name);
      return new Response('{"status":"undeployed"}', {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // POST /api/apps/:name/start - Start app
    const startMatch = url.pathname.match(/^\/api\/apps\/([^\/]+)\/start$/);
    if (startMatch && req.method === 'POST') {
      const name = startMatch[1];
      await platformInstance.startApp(name);
      return new Response('{"status":"started"}', {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // POST /api/apps/:name/scale - Scale app
    const scaleMatch = url.pathname.match(/^\/api\/apps\/([^\/]+)\/scale$/);
    if (scaleMatch && req.method === 'POST') {
      const name = scaleMatch[1];
      const body = await req.json() as { workers: number };

      const app = platformInstance.getApp(name);
      if (!app) {
        return new Response('{"error":"App not found"}', {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const previousWorkers = app.workers;
      await platformInstance.scaleApp(name, body.workers);

      return new Response(JSON.stringify({
        status: 'scaled',
        previousWorkers,
        currentWorkers: body.workers
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // POST /api/apps/:name/restart - Restart app
    const restartMatch = url.pathname.match(/^\/api\/apps\/([^\/]+)\/restart$/);
    if (restartMatch && req.method === 'POST') {
      const name = restartMatch[1];

      const app = platformInstance.getApp(name);
      if (!app) {
        return new Response('{"error":"App not found"}', {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Restart by stopping and starting
      if (app.status === 'running') {
        await platformInstance.stopApp(name);
        await platformInstance.startApp(name);
      } else {
        await platformInstance.startApp(name);
      }

      return new Response('{"status":"restarted"}', {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('{"error":"API endpoint not found"}', {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ Platform API error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

function getPlatformDashboard(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>🚀 Rip Platform Controller</title>
  <style>
    body { font-family: system-ui; margin: 40px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { background: white; padding: 30px; border-radius: 10px; margin-bottom: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .apps { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .app { padding: 15px; border: 1px solid #ddd; border-radius: 5px; margin: 10px 0; }
    .running { border-color: #4CAF50; background: #f8fff8; }
    .stopped { border-color: #ccc; background: #f8f8f8; }
    button { padding: 8px 16px; margin: 5px; border: none; border-radius: 4px; cursor: pointer; }
    .deploy { background: #4CAF50; color: white; }
    .start { background: #2196F3; color: white; }
    .stop { background: #f44336; color: white; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 Rip Platform Controller</h1>
      <p><strong>Revolutionary Dynamic Application Platform</strong></p>
      <p>Deploy, manage, and scale Rip applications on the fly!</p>
      <p>🌐 <strong>Platform API:</strong> <a href="/api/apps">/api/apps</a> | <strong>Stats:</strong> <a href="/api/stats">/api/stats</a></p>
    </div>

    <div class="apps">
      <h2>📱 Deployed Applications</h2>
      <div id="apps-list">Loading apps...</div>

      <h3>➕ Deploy New App</h3>
      <div>
        <input type="text" id="app-name" placeholder="App name (e.g., labs-api)" style="padding: 8px; margin: 5px;">
        <input type="text" id="app-path" placeholder="App path (e.g., apps/labs/api)" style="padding: 8px; margin: 5px;">
        <button class="deploy" onclick="deployApp()">Deploy App</button>
      </div>
    </div>
  </div>

  <script>
    async function loadApps() {
      try {
        const response = await fetch('/api/apps');
        const apps = await response.json();
        const container = document.getElementById('apps-list');

        if (apps.length === 0) {
          container.innerHTML = '<p>No apps deployed yet. Deploy your first app above!</p>';
          return;
        }

        container.innerHTML = apps.map(app => \`
          <div class="app \${app.status}">
            <h4>\${app.name}</h4>
            <p><strong>Directory:</strong> \${app.directory}</p>
            <p><strong>Ports:</strong> http:\${app.port} \${app.httpOk === true ? '🟢' : app.httpOk === false ? '🔴' : ''}\${app.httpsPort ? (", https:" + app.httpsPort + ' ' + (app.httpsOk === true ? '🟢' : app.httpsOk === false ? '🔴' : '')) : ''} | <strong>Status:</strong> \${app.status}</p>
            \${app.startedAt ? \`<p><strong>Started:</strong> \${new Date(app.startedAt).toLocaleString()}</p>\` : ''}
            <button class="start" onclick="startApp('\${app.name}')">Start</button>
            <button class="stop" onclick="undeployApp('\${app.name}')">Undeploy</button>
          </div>
        \`).join('');
      } catch (error) {
        document.getElementById('apps-list').innerHTML = '<p>Error loading apps: ' + error.message + '</p>';
      }
    }

    async function deployApp() {
      const name = document.getElementById('app-name').value;
      const path = document.getElementById('app-path').value;

      if (!name || !path) {
        alert('Please provide both app name and path');
        return;
      }

      try {
        const response = await fetch('/api/apps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, directory: path })
        });

        if (response.ok) {
          document.getElementById('app-name').value = '';
          document.getElementById('app-path').value = '';
          loadApps();
          alert('App deployed successfully!');
        } else {
          const error = await response.json();
          alert('Deploy failed: ' + error.error);
        }
      } catch (error) {
        alert('Deploy failed: ' + error.message);
      }
    }

    async function startApp(name) {
      try {
        const response = await fetch(\`/api/apps/\${name}/start\`, { method: 'POST' });
        if (response.ok) {
          loadApps();
          alert('App started successfully!');
        } else {
          const error = await response.json();
          alert('Start failed: ' + error.error);
        }
      } catch (error) {
        alert('Start failed: ' + error.message);
      }
    }

    async function undeployApp(name) {
      if (!confirm(\`Are you sure you want to undeploy \${name}?\`)) return;

      try {
        const response = await fetch(\`/api/apps/\${name}\`, { method: 'DELETE' });
        if (response.ok) {
          loadApps();
          alert('App undeployed successfully!');
        } else {
          const error = await response.json();
          alert('Undeploy failed: ' + error.error);
        }
      } catch (error) {
        alert('Undeploy failed: ' + error.message);
      }
    }

    // Load apps on page load and refresh every 5 seconds
    loadApps();
    setInterval(loadApps, 5000);
  </script>
</body>
</html>`;
}

function showHelp(): void {
  console.log(`🚀 Rip Application Server

Usage:
  bun server help                        # Show this help
  bun server status [--json]             # Show server status (machine-readable with --json)
  bun server stop [target] [--force]     # Stop server(s); optional target (app, platform[:port], or port); --force frees ports
  bun server [app-path]                  # Start server with app

Platform Mode (Dynamic Multi-App Management):
  bun server platform                    # Start platform controller
  bun server platform [port]             # Start platform on custom port
  bun server deploy <name> <path>        # Deploy app to platform
  bun server undeploy <name>             # Remove app from platform
  bun server list                        # List deployed apps
  bun server start <name>                # Start a deployed app
  bun server scale <name> <workers>      # Scale app workers
  bun server restart <name>              # Restart an app
  bun server apps                        # Show running apps

HTTPS/CA Management:
  bun server ca:init                     # Initialize Certificate Authority
  bun server ca:trust                    # Trust CA in system keychain (macOS)
  bun server ca:export                   # Export CA certificate for manual import
  bun server ca:info                     # Show CA certificate information
  bun server ca:list                     # List generated certificates
  bun server ca:clean                    # Clean old certificates

Examples:
  bun server apps/labs/api                  # Start labs API directly
  bun server status --json                  # Status in JSON with exit code
  bun server stop api                       # Stop a specific direct-mode app
  bun server stop platform:3100             # Stop platform on port 3100
  bun server stop 3000 --force              # Free a stuck HTTP port
  bun server platform                       # Start platform controller
  bun server deploy labs-api apps/labs/api  # Deploy to platform
  bun server start labs-api                 # Start deployed app
  bun server ca:init                        # Set up development CA
  bun server https:quick apps/labs/api      # Direct mode with quick HTTPS
  bun server http+https w:4                 # Serve both protocols with 4 workers
  bun server ca:trust                       # Trust CA (no more browser warnings!)

Flexible Arguments (ANY order):
  bun server w:5 8080 apps/labs/api         # 5 workers, port 8080, directory
  bun server apps/labs/api prod w:10        # Directory, prod mode, 10 workers
  bun server deploy labs-api w:3 apps/labs/api  # Deploy with 3 workers
  bun server 3001 dev examples/hello       # Port, mode, directory
  bun server w:8 r:500 prod apps/labs/api  # Workers, requests, mode, directory`);
}

// ===== HTTPS/CA UTILITY FUNCTIONS =====

// Ensure directories exist
function ensureDirectories() {
  if (!existsSync(RIP_CONFIG_DIR)) {
    mkdirSync(RIP_CONFIG_DIR, { recursive: true });
  }
  if (!existsSync(CA_DIR)) {
    mkdirSync(CA_DIR, { recursive: true });
  }
  if (!existsSync(CERTS_DIR)) {
    mkdirSync(CERTS_DIR, { recursive: true });
  }
  if (!existsSync(RUN_DIR)) {
    mkdirSync(RUN_DIR, { recursive: true });
  }
}

// Check if CA exists
function hasCA(): boolean {
  return (
    existsSync(join(CA_DIR, 'root.crt')) && existsSync(join(CA_DIR, 'root.key'))
  );
}

// Initialize CA
async function initCA(): Promise<void> {
  ensureDirectories();

  console.log('🔐 Initializing Certificate Authority...');

  const rootKey = join(CA_DIR, 'root.key');
  const rootCrt = join(CA_DIR, 'root.crt');

  // Generate Root CA key
  const keyProc = spawn(['openssl', 'genrsa', '-out', rootKey, '3072'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  await keyProc.exited;

  // Generate Root CA certificate
  const certProc = spawn(
    [
      'openssl',
      'req',
      '-x509',
      '-nodes',
      '-sha256',
      '-new',
      '-key',
      rootKey,
      '-out',
      rootCrt,
      '-days',
      '731',
      '-subj',
      '/CN=Rip Server Development CA',
      '-addext',
      'keyUsage = critical, keyCertSign',
      '-addext',
      'basicConstraints = critical, CA:TRUE, pathlen:0',
      '-addext',
      'subjectKeyIdentifier = hash',
    ],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );

  await certProc.exited;

  console.log('✅ CA initialized at ~/.rip-server/ca/');
}

// Generate CA-signed certificate
async function generateCACert(
  domain = 'localhost',
): Promise<{ cert: string; key: string }> {
  ensureDirectories();

  if (!hasCA()) {
    await initCA();
  }

  const certKey = join(CERTS_DIR, `${domain}.key`);
  const certCsr = join(CERTS_DIR, `${domain}.csr`);
  const certCrt = join(CERTS_DIR, `${domain}.crt`);

  // Check if cert already exists
  if (existsSync(certCrt) && existsSync(certKey)) {
    return {
      cert: await Bun.file(certCrt).text(),
      key: await Bun.file(certKey).text(),
    };
  }

  console.log(`🔐 Generating certificate for ${domain}...`);

  // Get local IP
  const getLocalIP = async (): Promise<string> => {
    if (process.platform === 'darwin') {
      const proc = spawn(['ipconfig', 'getifaddr', 'en0'], { stdout: 'pipe' });
      const output = await new Response(proc.stdout).text();
      return output.trim() || '127.0.0.1';
    }
    return '127.0.0.1';
  };

  const localIP = await getLocalIP();

  // Generate site key
  const keyProc = spawn(['openssl', 'genrsa', '-out', certKey, '2048'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  await keyProc.exited;

  // Generate CSR
  const csrProc = spawn(
    [
      'openssl',
      'req',
      '-sha256',
      '-new',
      '-key',
      certKey,
      '-out',
      certCsr,
      '-subj',
      `/CN=${domain}`,
    ],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );

  await csrProc.exited;

  // Sign the certificate
  const signProc = spawn(
    [
      'openssl',
      'x509',
      '-req',
      '-sha256',
      '-in',
      certCsr,
      '-out',
      certCrt,
      '-days',
      '731',
      '-CAkey',
      join(CA_DIR, 'root.key'),
      '-CA',
      join(CA_DIR, 'root.crt'),
      '-CAcreateserial',
      '-extfile',
      '/dev/stdin',
    ],
    {
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: Bun.spawn(
        [
          'echo',
          `subjectAltName = DNS:${domain},DNS:*.${domain},DNS:localhost,IP:127.0.0.1,IP:${localIP}
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
basicConstraints = CA:FALSE
authorityKeyIdentifier = keyid:always
subjectKeyIdentifier = hash`,
        ],
        { stdout: 'pipe' },
      ).stdout,
    },
  );

  await signProc.exited;

  // Clean up CSR
  await Bun.spawn(['rm', '-f', certCsr]).exited;

  return {
    cert: await Bun.file(certCrt).text(),
    key: await Bun.file(certKey).text(),
  };
}

// Generate self-signed certificate
async function generateSelfSignedCert(): Promise<{
  cert: string;
  key: string;
}> {
  console.log('🔐 Generating self-signed certificate...');

  // Use openssl to generate a self-signed cert
  const proc = spawn(
    [
      'openssl',
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      '/tmp/rip-key.pem',
      '-out',
      '/tmp/rip-cert.pem',
      '-days',
      '365',
      '-nodes',
      '-subj',
      '/CN=localhost',
    ],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );

  await proc.exited;

  const cert = await Bun.file('/tmp/rip-cert.pem').text();
  const key = await Bun.file('/tmp/rip-key.pem').text();

  return { cert, key };
}

// Trust CA on system
async function trustCA(): Promise<void> {
  if (!hasCA()) {
    console.error('❌ No CA found. Run "bun server ca:init" first.');
    return;
  }

  const rootCrt = join(CA_DIR, 'root.crt');

  if (process.platform === 'darwin') {
    console.log('🔐 Adding CA to macOS keychain...');
    const proc = spawn(
      [
        'sudo',
        'security',
        'add-trusted-cert',
        '-d',
        '-r',
        'trustRoot',
        '-k',
        '/Library/Keychains/System.keychain',
        rootCrt,
      ],
      {
        stdout: 'inherit',
        stderr: 'inherit',
        stdin: 'inherit',
      },
    );

    const code = await proc.exited;
    if (code === 0) {
      console.log('✅ CA trusted in system keychain');
    } else {
      console.error('❌ Failed to trust CA');
    }
  } else {
    console.log('ℹ️  Manual trust required for your OS');
    console.log(`   CA certificate: ${rootCrt}`);
  }
}

// Export CA certificate
async function exportCA(): Promise<void> {
  if (!hasCA()) {
    console.error('❌ No CA found. Run "bun server ca:init" first.');
    return;
  }

  const rootCrt = join(CA_DIR, 'root.crt');
  const exportPath = join(process.cwd(), 'rip-server-ca.crt');

  await Bun.write(exportPath, Bun.file(rootCrt));
  console.log(`✅ CA certificate exported to: ${exportPath}`);
  console.log('   Import this certificate to your browser as a trusted root CA');
}

// Show CA info
async function showCAInfo(): Promise<void> {
  if (!hasCA()) {
    console.log('❌ No CA found. Run "bun server ca:init" to create one.');
    return;
  }

  const rootCrt = join(CA_DIR, 'root.crt');

  console.log('🔐 Certificate Authority Information:');
  console.log(`   Location: ${CA_DIR}`);
  console.log(`   Certificate: ${rootCrt}`);

  const proc = spawn(
    ['openssl', 'x509', '-in', rootCrt, '-noout', '-subject', '-dates'],
    {
      stdout: 'inherit',
      stderr: 'inherit',
    },
  );

  await proc.exited;
}

// List generated certificates
async function listCerts(): Promise<void> {
  ensureDirectories();

  console.log('📜 Generated Certificates:');
  console.log(`   Directory: ${CERTS_DIR}`);

  const proc = spawn(['ls', '-la', CERTS_DIR], {
    stdout: 'inherit',
    stderr: 'inherit',
  });

  await proc.exited;
}

// Clean old certificates
async function cleanCerts(): Promise<void> {
  console.log('🧹 Cleaning certificates...');

  const proc = spawn(['rm', '-rf', CERTS_DIR], {
    stdout: 'inherit',
    stderr: 'inherit',
  });

  await proc.exited;

  mkdirSync(CERTS_DIR, { recursive: true });
  console.log('✅ Certificates cleaned');
}

// ===== MAIN FUNCTION =====

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Use flexible argument parsing
  const config = parseArgs(args);

  // Determine the command
  let finalCommand = config.command;

  // If no explicit command but we have arguments, check if we should start a server
  if (!finalCommand) {
    if (args.length === 0) {
      finalCommand = 'help';
    } else if (config.appDir || args.some(arg => arg.includes('/') || existsSync(arg))) {
      // We have a directory specified, so start the server
      finalCommand = 'start';
      // If appDir not set, try to find it from args
      if (!config.appDir) {
        const dirArg = args.find(arg => arg.includes('/') || existsSync(arg));
        if (dirArg) {
          config.appDir = resolve(dirArg);
        }
      }
    } else {
      finalCommand = 'help';
    }
  }

  switch (finalCommand) {
    case 'help':
      showHelp();
      break;

    case 'status':
      await showStatus();
      break;

    case 'stop': {
      const force = args.includes('--force');
      const target = args.find(a => a !== 'stop' && a !== '--force');
      await stopServer(force, target);
      break;
    }

    // Platform commands
    case 'platform': {
      // allow optional port e.g. `bun server platform 3100`
      const portArg = args.find(a => /^\d+$/.test(a));
      const p = portArg ? Number.parseInt(portArg) : 3000;
      await startPlatform(p);
      break;
    }

    case 'deploy':
      await handleDeploy(config, args.slice(1));
      break;

    case 'undeploy':
      await handleUndeploy(args[1]);
      break;

    case 'list':
    case 'apps':
      await handleListApps();
      break;

    case 'start':
      // Handle both platform start and direct server start
      if (args.length > 0 && args[0] && !args[0].includes('/') && !existsSync(args[0]) && !args[0].startsWith('w:') && !args[0].startsWith('r:')) {
        // Platform app start (e.g., "start labs-api")
        await handleStartApp(args[0]);
      } else {
        // Direct server start with flexible args
        const appPath = config.appDir || process.cwd();
        await startServer(appPath, config);
      }
      break;

    case 'scale':
      await handleScale(args[1], args[2]);
      break;

    case 'restart':
      await handleRestartApp(args[1]);
      break;

    // CA management commands
    case 'ca:init':
      await initCA();
      break;

    case 'ca:trust':
      await trustCA();
      break;

    case 'ca:export':
      await exportCA();
      break;

    case 'ca:info':
      await showCAInfo();
      break;

    case 'ca:list':
      await listCerts();
      break;

    case 'ca:clean':
      await cleanCerts();
      break;

    default:
      // Treat anything else as an app path or use flexible config
      let appPath: string;
      if (config.appDir) {
        appPath = config.appDir;
      } else {
        appPath = finalCommand.startsWith('./') || finalCommand.startsWith('/') || finalCommand.includes('/')
          ? finalCommand
          : process.cwd();
      }
      await startServer(appPath, config);
      break;
  }
}

// Platform command handlers
async function handleDeploy(config: Config, remainingArgs: string[]): Promise<void> {
  // Extract name and directory from remaining args or config
  let name = remainingArgs[0];
  let directory: string | undefined;

  // Find the directory from remaining args (skip w: and r: arguments)
  for (const arg of remainingArgs.slice(1)) {
    if (!arg.startsWith('w:') && !arg.startsWith('r:') && (arg.includes('/') || existsSync(arg))) {
      directory = arg;
      break;
    }
  }

  // Fallback to config appDir
  if (!directory && config.appDir && config.appDir !== process.cwd()) {
    directory = config.appDir;
  }

  if (!name || !directory) {
    console.error('❌ Usage: bun server deploy <name> <directory>');
    console.error('   Example: bun server deploy labs-api apps/labs/api');
    console.error('   Flexible: bun server deploy labs-api w:5 apps/labs/api');
    process.exit(1);
  }

  // Apply flexible config options
  const deployData: any = { name, directory };
  if (config.workers) deployData.workers = config.workers;
  if (config.httpPort) deployData.port = config.httpPort;
  if (config.protocol) deployData.protocol = config.protocol;
  if (config.httpsPort) deployData.httpsPort = config.httpsPort;
  if (config.certPath && config.keyPath) {
    deployData.cert = await Bun.file(config.certPath).text().catch(() => undefined);
    deployData.key = await Bun.file(config.keyPath).text().catch(() => undefined);
  }
  if (config.jsonLogging) deployData.jsonLogging = true;
  if (config.requests) deployData.requests = config.requests;

  // If https is requested but no cert/key provided, generate them here
  if ((config.protocol === 'https' || config.protocol === 'http+https') && (!deployData.cert || !deployData.key)) {
    const mode = config.httpsMode ?? 'smart';
    try {
      if (mode === 'quick') {
        const { cert, key } = await generateSelfSignedCert();
        deployData.cert = cert; deployData.key = key;
      } else if (mode === 'ca') {
        const { cert, key } = await generateCACert('localhost');
        deployData.cert = cert; deployData.key = key;
      } else {
        if (hasCA()) {
          const { cert, key } = await generateCACert('localhost');
          deployData.cert = cert; deployData.key = key;
        } else {
          const { cert, key } = await generateSelfSignedCert();
          deployData.cert = cert; deployData.key = key;
        }
      }
    } catch (e) {
      console.warn('⚠️  Failed to auto-generate HTTPS certs for deploy; proceeding without HTTPS material');
    }
  }

  try {
    const response = await fetch('http://localhost:3000/api/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deployData)
    });

    if (response.ok) {
      const app = await response.json();
      console.log(`✅ App '${name}' deployed successfully`);
      console.log(`📁 Directory: ${app.directory}`);
      console.log(`🌐 Port: ${app.port}`);

      // Auto-start the app after deploy
      try {
        const startResp = await fetch(`http://localhost:3000/api/apps/${name}/start`, { method: 'POST' });
        if (startResp.ok) {
          console.log(`🚀 App '${name}' started`);
          console.log(`🌐 Available at: http://localhost:${app.port}`);
        } else {
          console.warn(`⚠️  App '${name}' deployed but failed to start. Use: bun server start ${name}`);
        }
      } catch (_) {
        console.warn(`⚠️  App '${name}' deployed but failed to start. Use: bun server start ${name}`);
      }
    } else {
      const error = await response.json();
      console.error(`❌ Deploy failed: ${error.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Platform not running. Start it with: bun server platform');
    process.exit(1);
  }
}

async function handleUndeploy(name?: string): Promise<void> {
  if (!name) {
    console.error('❌ Usage: bun server undeploy <name>');
    console.error('   Example: bun server undeploy labs-api');
    process.exit(1);
  }

  try {
    const response = await fetch(`http://localhost:3000/api/apps/${name}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      console.log(`✅ App '${name}' undeployed successfully`);
    } else {
      const error = await response.json();
      console.error(`❌ Undeploy failed: ${error.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Platform not running. Start it with: bun server platform');
    process.exit(1);
  }
}

async function handleListApps(): Promise<void> {
  try {
    const response = await fetch('http://localhost:3000/api/apps');

    if (response.ok) {
      const apps = await response.json();

      console.log('📱 Deployed Applications:');
      console.log('');

      if (apps.length === 0) {
        console.log('   No apps deployed yet');
        console.log('   Deploy your first app: bun server deploy <name> <path>');
        return;
      }

      apps.forEach((app: AppConfig) => {
        console.log(`   🚀 ${app.name}`);
        console.log(`      📁 Directory: ${app.directory}`);
        const httpsInfo = app.httpsPort ? `, https:${app.httpsPort}` : '';
        console.log(`      🌐 Port: http:${app.port}${httpsInfo}`);
        console.log(`      📊 Status: ${app.status}`);
        if (app.startedAt) {
          console.log(`      ⏰ Started: ${new Date(app.startedAt).toLocaleString()}`);
        }
        console.log('');
      });
    } else {
      console.error('❌ Failed to fetch apps');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Platform not running. Start it with: bun server platform');
    process.exit(1);
  }
}

async function handleStartApp(name?: string): Promise<void> {
  if (!name) {
    console.error('❌ Usage: bun server start <name>');
    console.error('   Example: bun server start labs-api');
    process.exit(1);
  }

  try {
    const response = await fetch(`http://localhost:3000/api/apps/${name}/start`, {
      method: 'POST'
    });

    if (response.ok) {
      console.log(`✅ App '${name}' started successfully`);
      console.log('🌐 Available at: http://localhost:3000');
    } else {
      const error = await response.json();
      console.error(`❌ Start failed: ${error.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Platform not running. Start it with: bun server platform');
    process.exit(1);
  }
}

async function handleScale(name?: string, workersStr?: string): Promise<void> {
  if (!name || !workersStr) {
    console.error('❌ Usage: bun server scale <name> <workers>');
    console.error('   Example: bun server scale labs-api 5');
    process.exit(1);
  }

  const workers = parseInt(workersStr);
  if (isNaN(workers) || workers < 1 || workers > 20) {
    console.error('❌ Worker count must be a number between 1 and 20');
    process.exit(1);
  }

  try {
    const response = await fetch(`http://localhost:3000/api/apps/${name}/scale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workers }),
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`🚀 App '${name}' scaled to ${workers} workers`);
      console.log(`📊 Previous: ${result.previousWorkers} → Current: ${result.currentWorkers} workers`);
    } else {
      const error = await response.json();
      console.error(`❌ Scale failed: ${error.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Platform not running. Start it with: bun server platform');
    process.exit(1);
  }
}

async function handleRestartApp(name?: string): Promise<void> {
  if (!name) {
    console.error('❌ Usage: bun server restart <name>');
    console.error('   Example: bun server restart labs-api');
    process.exit(1);
  }

  try {
    const response = await fetch(`http://localhost:3000/api/apps/${name}/restart`, {
      method: 'POST',
    });

    if (response.ok) {
      console.log(`🔄 App '${name}' restarted successfully`);
    } else {
      const error = await response.json();
      console.error(`❌ Restart failed: ${error.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Platform not running. Start it with: bun server platform');
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}
