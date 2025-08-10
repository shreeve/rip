/**
 * 🔥 Rip Worker - Sequential Request Handler
 *
 * Handles HTTP requests with perfect isolation:
 * - One request at a time per worker (sequential processing)
 * - Full .rip language support via transpilation
 * - Unix socket communication for performance
 * - Graceful shutdown on request limits or SIGTERM
 * - Perfect request isolation and predictable resource usage
 */

/// <reference types="bun-types" />

// Make this a module to allow top-level await
export {};
import { existsSync } from 'fs';
import { join } from 'path';

// Configuration
const workerId = Number.parseInt(process.argv[2] ?? '0');
const workerNum = workerId + 1; // Human-friendly worker number (1-indexed)

// Set process title for better visibility
const appName = process.argv[5] || 'unknown';
process.title = `rip-worker-${appName}-${workerNum}`;

const baseMaxRequests = Number.parseInt(process.argv[3] ?? '100');
const appDirectory = process.argv[4] ?? process.cwd();

// 🎯 Rolling restart strategy: Stagger request limits to prevent simultaneous shutdowns
const requestVariance = Math.floor(baseMaxRequests * 0.1); // 10% variance
const workerOffset = workerId * 0.05 - 0.05; // -5%, 0%, +5%, +10%, etc.
const maxRequests = Math.max(
  1,
  baseMaxRequests +
    Math.floor(baseMaxRequests * workerOffset) +
    Math.floor(Math.random() * requestVariance),
);

// Worker timeout protection (30 seconds per request)
const WORKER_TIMEOUT = 30000;

let requestsHandled = 0;
let isShuttingDown = false;
let requestInProgress = false;

const socketPath = `/tmp/rip_worker_${appName}_${workerId}.sock`;

// Clean up any existing socket file
try {
  await Bun.spawn(['rm', '-f', socketPath]).exited;
} catch (_) {
  // Socket didn't exist, that's fine
}

/**
 * Load the user's Rip application
 */
let ripApp: any = null;

async function loadRipApp(): Promise<void> {
  // Discover entry point (multiple candidates for POLS)
  const candidates = [
    'index.rip', 'app.rip', 'server.rip', 'main.rip',
    'index.ts', // allow TS entry if user prefers
  ];
  let entryPath: string | null = null;
  for (const file of candidates) {
    const abs = appDirectory.startsWith('/')
      ? join(appDirectory, file)
      : join(process.cwd(), appDirectory, file);
    if (existsSync(abs)) { entryPath = abs; break; }
  }
  const indexPath = entryPath || (appDirectory.startsWith('/') ? join(appDirectory, 'index.rip') : join(process.cwd(), appDirectory, 'index.rip'));

  try {
    console.log(`📁 [Worker ${workerNum}] Loading Rip app from ${indexPath}`);

    // Dynamic import to load the .rip application
    // The Rip transpiler should already be loaded via --preload
    const module = await import(indexPath);
    ripApp = module.default || module;

    if (!ripApp) {
      throw new Error('No default export found in Rip app');
    }

    console.log(`✅ [Worker ${workerNum}] Loaded Rip app successfully`);
  } catch (error) {
    console.error(`❌ [Worker ${workerNum}] Failed to load Rip app:`, error);
    console.error(`   Path: ${indexPath}`);
    console.error(`   CWD: ${process.cwd()}`);
    process.exit(1);
  }
}

/**
 * Handle a single HTTP request
 */
async function handleRequest(req: Request): Promise<Response> {
  if (!ripApp) {
    return new Response('Worker not ready', { status: 503 });
  }

  requestInProgress = true;
  let timeoutId: Timer;
  const start = Date.now();

  try {
    // Set up request timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, WORKER_TIMEOUT);
    });

    // Handle the request
    const requestPromise = (async () => {
      if (typeof ripApp === 'function') {
        return await ripApp(req);
      } else if (ripApp && typeof ripApp.fetch === 'function') {
        return await ripApp.fetch(req);
      } else {
        return new Response('Invalid Rip app', { status: 500 });
      }
    })();

    // Race between request and timeout
    const response = await Promise.race([requestPromise, timeoutPromise]);

    clearTimeout(timeoutId);
    requestsHandled++;

    // Check if we should shutdown after this request
    if (requestsHandled >= maxRequests) {
      console.log(`🔄 [Worker ${workerNum}] Reached max requests (${maxRequests}), shutting down for restart`);
      setTimeout(() => process.exit(0), 100);
    }

    // Simple per-worker console log (JSON if requested)
    const totalMs = Date.now() - start;
    const url = new URL(req.url);
    const useJson = false; // Worker logs always follow server option; platform focuses server logs
    if (useJson) {
      const len = response.headers.get('content-length');
      const type = (response.headers.get('content-type') || '').split(';')[0] || undefined;
      console.log(JSON.stringify({
        t: new Date().toISOString(),
        role: 'worker',
        app: appName,
        worker: workerNum,
        method: (req as any).method || 'GET',
        path: url.pathname,
        status: response.status,
        totalMs,
        type,
        length: len ? Number(len) : undefined,
      }));
    } else {
      const pad = (n: number, w = 2) => String(n).padStart(w, '0');
      const now = new Date();
      const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}`;
      const tzMin = now.getTimezoneOffset();
      const tzSign = tzMin <= 0 ? '+' : '-';
      const tzAbs = Math.abs(tzMin);
      const tzStr = `${tzSign}${String(Math.floor(tzAbs / 60)).padStart(2, '0')}${String(tzAbs % 60).padStart(2, '0')}`;
      const fmt = (ms: number) => (ms < 1000 ? `${(ms < 100 ? (ms < 10 ? ms.toFixed(1) : Math.round(ms).toString()) : Math.round(ms).toString()).padStart(3,' ')}m` + 's' : `${(ms/1000 < 100 ? (ms/1000).toFixed(1) : Math.round(ms/1000).toString()).padStart(3,' ')} ` + 's');
      console.log(`[${ts} ${tzStr} ${fmt(totalMs)}   ] W${workerNum} ${(req as any).method || 'GET'} ${url.pathname} → ${response.status}`);
    }

    return response;

  } catch (error) {
    clearTimeout(timeoutId!);
    console.error(`❌ [Worker ${workerNum}] Request error:`, error);
    return new Response('Internal Server Error', { status: 500 });
  } finally {
    requestInProgress = false;
  }
}

/**
 * Start the worker server
 */
async function startWorker(): Promise<void> {
  // Load the Rip application first
  await loadRipApp();

  // Create Unix socket server
  const server = Bun.serve({
    unix: socketPath,
    async fetch(req: Request): Promise<Response> {
      if (isShuttingDown) {
        return new Response('Worker shutting down', { status: 503 });
      }

      if (requestInProgress) {
        return new Response('Worker busy', { status: 503 });
      }

      const res = await handleRequest(req);
      // Disable browser/proxy caching by default to avoid old responses after reload
      const headers = new Headers(res.headers);
      headers.set('Cache-Control', 'no-store');
      headers.set('Pragma', 'no-cache');
      headers.set('Expires', '0');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    },
  });

  console.log(`🚀 [Worker ${workerNum}] Started for app '${appName}' on socket ${socketPath}`);
  console.log(`📊 [Worker ${workerNum}] Max requests: ${maxRequests}`);

  // Graceful shutdown handling
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`🛑 [Worker ${workerNum}] Graceful shutdown initiated...`);

    // Wait for current request to finish
    while (requestInProgress) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    server.stop();

    // Clean up socket
    try {
      await Bun.spawn(['rm', '-f', socketPath]).exited;
    } catch (_) {
      // Socket cleanup failed, continue
    }

    console.log(`✅ [Worker ${workerNum}] Shutdown complete`);
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    console.error(`💥 [Worker ${workerNum}] Uncaught exception:`, error);
    shutdown();
  });

  process.on('unhandledRejection', (reason) => {
    console.error(`💥 [Worker ${workerNum}] Unhandled rejection:`, reason);
    shutdown();
  });
}

// Start the worker
startWorker().catch((error) => {
  console.error(`💥 [Worker ${workerNum}] Failed to start:`, error);
  process.exit(1);
});