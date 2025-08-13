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

const baseMaxRequests = Number.parseInt(process.argv[3] ?? '10000'); // Much higher for load testing
const appDirectory = process.argv[4] ?? process.cwd();

const maxRequests = baseMaxRequests;

// Worker timeout protection (30 seconds per request)
const WORKER_TIMEOUT = 30000;

let requestsHandled = 0;
let isShuttingDown = false;
let requestInProgress = false;

// All workers listen on the same shared socket (nginx + unicorn pattern)
const socketPath = process.env.SOCKET_PATH || `/tmp/rip_shared_${appName}.sock`;

// Note: Socket cleanup is handled by the manager, not individual workers

/**
 * Load the user's Rip application
 */
let ripApp: any = null;
let appReady = false;

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
    appReady = true;
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
      const url = new URL(req.url);
      if (url.pathname === '/__ready') {
        return new Response(appReady ? 'ok' : 'not-ready');
      }
      if (isShuttingDown) {
        return new Response('Worker shutting down', { status: 503 });
      }

      // Note: No "busy" check - kernel handles load balancing to available workers

      const res = await handleRequest(req);
      // Disable browser/proxy caching by default to avoid old responses after reload
      const headers = new Headers(res.headers);
      headers.set('Cache-Control', 'no-store');
      headers.set('Pragma', 'no-cache');
      headers.set('Expires', '0');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    },
  });

  console.log(`🚀 [Worker ${workerNum}] Started for app '${appName}' (socket: ${socketPath}, max requests: ${maxRequests})`);

  // Graceful shutdown handling
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    // Graceful shutdown in progress

    // Wait for current request to finish
    while (requestInProgress) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    server.stop();

    // Note: Shared socket cleanup is handled by the manager
    // Shutdown complete
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