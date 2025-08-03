/**
 * 🔥 Rip Worker - Sequential Request Handler
 *
 * Handles HTTP requests with perfect isolation:
 * - One request at a time per worker (sequential processing)
 * - Full .rip language support via transpilation
 * - Unix socket communication for performance
 * - Graceful shutdown on request limits or SIGTERM
 * - Perfect request isolation and predictable resource usage
 * - Auto-restart capability
 *
 * Usage: bun worker.ts [workerId] [maxRequests] [appDirectory]
 */

// Configuration
const workerId = parseInt(process.argv[2] ?? "0");
const workerNum = workerId + 1; // Human-friendly worker number (1-indexed)
const maxRequests = parseInt(process.argv[3] ?? "100");
const appDirectory = process.argv[4] ?? process.cwd();

let requestsHandled = 0;
let isShuttingDown = false;
let requestInProgress = false;

const socketPath = `/tmp/rip_worker_${workerId}.sock`;

// Clean up any existing socket file
try {
  await Bun.unlink(socketPath);
} catch (_) {
  // Socket didn't exist, that's fine
}

/**
 * Load the user's Rip application
 * This is where we import their actual .rip application code
 */
const loadRipApplication = async () => {
  try {
    // Try to load the main application file
    // This could be index.rip, app.rip, or server.rip
    const possibleFiles = ['index.rip', 'app.rip', 'server.rip', 'main.rip'];

    for (const file of possibleFiles) {
      try {
        const appPath = `${appDirectory}/${file}`;
        console.log(`🔍 [Worker ${workerNum}] Trying to load: ${appPath}`);

        // Import the .rip file (will be transpiled by bunfig.toml)
        const app = await import(appPath);

        console.log(`✅ [Worker ${workerNum}] Loaded application from: ${file}`);
        return app.default || app;
      } catch (error) {
        // Try next file
        continue;
      }
    }

    // Fallback: create a simple default handler
    console.log(`⚠️ [Worker ${workerNum}] No .rip app found, using default handler`);
    return {
      fetch: (req: Request) => {
        return new Response(`Hello from Rip Worker ${workerNum}! (request #${requestsHandled + 1})\n\nNo .rip application found. Create index.rip, app.rip, or server.rip in ${appDirectory}`, {
          headers: { "Content-Type": "text/plain" }
        });
      }
    };

  } catch (error) {
    console.error(`❌ [Worker ${workerNum}] Error loading application:`, error);

    // Return error handler
    return {
      fetch: (req: Request) => {
        return new Response(`Error in Rip Worker ${workerNum}: ${error.message}`, {
          status: 500,
          headers: { "Content-Type": "text/plain" }
        });
      }
    };
  }
};

/**
 * Main worker logic
 */
const main = async () => {
  console.log(`🔥 [Worker ${workerNum}] Starting Rip worker...`);
console.log(`📊 [Worker ${workerNum}] Will handle up to ${maxRequests} requests`);
console.log(`📁 [Worker ${workerNum}] App directory: ${appDirectory}`);

  // Load the user's Rip application
  const ripApp = await loadRipApplication();

  // Create the Unix socket server
  const server = Bun.serve({
    unix: socketPath,
    async fetch(req) {
      // Check if shutting down
      if (isShuttingDown) {
        return new Response("Server shutting down", { status: 503 });
      }

      // 🎯 Sequential Processing: Only handle one request at a time
      if (requestInProgress) {
        console.log(`⏸️ [Worker ${workerNum}] Request queued - worker busy with request #${requestsHandled}`);
        return new Response("Worker busy - perfect isolation in progress", {
          status: 503,
          headers: {
            "Content-Type": "text/plain",
            "Retry-After": "1"
          }
        });
      }

      // Mark request as in progress for perfect isolation
      requestInProgress = true;
      requestsHandled++;

      // Capture request details for logging
      const startDate = new Date();
      const startTime = startDate.getTime();
      const method = req.method;
      const url = new URL(req.url).pathname;

      try {
        // Call the user's application
        let response;

        if (typeof ripApp === 'function') {
          // Direct function export
          response = await ripApp(req);
        } else if (ripApp && typeof ripApp.fetch === 'function') {
          // Hono-style app with fetch method
          response = await ripApp.fetch(req);
        } else if (ripApp && typeof ripApp.handler === 'function') {
          // Custom handler function
          response = await ripApp.handler(req);
        } else {
          // Fallback
          response = new Response(`Rip Worker ${workerNum} - Request #${requestsHandled} (Sequential Mode)`, {
            headers: { "Content-Type": "text/plain" }
          });
        }

        // Calculate duration and response details
        const duration = Date.now() - startTime;
        const timestamp = startDate.toISOString().slice(0, 23).replace('T', ' ') +
                         (startDate.getTimezoneOffset() <= 0 ? '+' : '-') +
                         String(Math.abs(Math.floor(startDate.getTimezoneOffset() / 60))).padStart(2, '0') +
                         ':' + String(Math.abs(startDate.getTimezoneOffset() % 60)).padStart(2, '0'); // YYYY-MM-DD HH:MM:SS.mmm±HH:MM format
        const status = response.status;
        const contentType = response.headers.get('content-type') || 'unknown';
        const contentLength = response.headers.get('content-length') || '?';

        // Format content type (shorten common ones)
        const shortType = contentType.split(';')[0]
          .replace('application/', '')
          .replace('text/', '')
          .replace('image/', 'img/')
          .substring(0, 8); // Limit length

        // Clean, compact one-line log
        console.log(`[${timestamp}] W${workerNum}.${requestsHandled} ${method} ${url} → ${status} ${shortType} ${contentLength}b ${duration}ms`);

        // Check if worker should shut down
        if (requestsHandled >= maxRequests) {
          console.log(`✅ [Worker ${workerNum}] Reached ${maxRequests} requests. Scheduling graceful shutdown.`);

          // Schedule shutdown after this request completes
          setTimeout(() => {
            gracefulShutdown("Request limit reached");
          }, 0);
        }

        return response;

      } catch (error) {
        console.error(`❌ [Worker ${workerNum}] Request #${requestsHandled} error:`, error);

        return new Response(`Rip Worker ${workerNum} Error: ${error.message}`, {
          status: 500,
          headers: { "Content-Type": "text/plain" }
        });
      } finally {
        // 🎯 Release the worker for the next request
        requestInProgress = false;
      }
    },
  });

  /**
   * Graceful shutdown handler
   */
  const gracefulShutdown = (reason: string) => {
    if (isShuttingDown) return;

    isShuttingDown = true;
    // Stop accepting new requests
    server.stop(false); // false = don't force, wait for current requests

    // Exit after a delay to ensure cleanup
    setTimeout(() => {
      process.exit(0);
    }, 100);
  };

  // Handle shutdown signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM received'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT received'));

  console.log(`🚀 [Worker ${workerNum}] Ready on ${socketPath}`);
  console.log(`⚡ [Worker ${workerNum}] Waiting for requests...`);
};

// Start the worker
main().catch(console.error);