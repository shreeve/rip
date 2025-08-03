/**
 * 🔥 RIP Worker - Revolutionary Request Handler
 *
 * Handles HTTP requests with:
 * - Full .rip language support via transpilation
 * - Unix socket communication for performance
 * - Graceful shutdown on request limits or SIGTERM
 * - Auto-restart capability
 *
 * Usage: bun worker.ts [workerId] [maxRequests] [appDirectory]
 */

// Configuration
const workerId = process.argv[2] ?? "0";
const maxRequests = parseInt(process.argv[3] ?? "100");
const appDirectory = process.argv[4] ?? process.cwd();

let requestsHandled = 0;
let isShuttingDown = false;

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
        console.log(`🔍 [Worker ${workerId}] Trying to load: ${appPath}`);

        // Import the .rip file (will be transpiled by bunfig.toml)
        const app = await import(appPath);

        console.log(`✅ [Worker ${workerId}] Loaded application from: ${file}`);
        return app.default || app;
      } catch (error) {
        // Try next file
        continue;
      }
    }

    // Fallback: create a simple default handler
    console.log(`⚠️ [Worker ${workerId}] No .rip app found, using default handler`);
    return {
      fetch: (req: Request) => {
        return new Response(`Hello from RIP Worker ${workerId}! (request #${requestsHandled + 1})\n\nNo .rip application found. Create index.rip, app.rip, or server.rip in ${appDirectory}`, {
          headers: { "Content-Type": "text/plain" }
        });
      }
    };

  } catch (error) {
    console.error(`❌ [Worker ${workerId}] Error loading application:`, error);

    // Return error handler
    return {
      fetch: (req: Request) => {
        return new Response(`Error in RIP Worker ${workerId}: ${error.message}`, {
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
  console.log(`🔥 [Worker ${workerId}] Starting RIP worker...`);
  console.log(`📊 [Worker ${workerId}] Will handle up to ${maxRequests} requests`);
  console.log(`📁 [Worker ${workerId}] App directory: ${appDirectory}`);

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

      requestsHandled++;

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
          response = new Response(`RIP Worker ${workerId} - Request #${requestsHandled}`, {
            headers: { "Content-Type": "text/plain" }
          });
        }

        // Check if worker should shut down
        if (requestsHandled >= maxRequests) {
          console.log(`✅ [Worker ${workerId}] Reached ${maxRequests} requests. Scheduling graceful shutdown.`);

          // Schedule shutdown after this request completes
          setTimeout(() => {
            gracefulShutdown("Request limit reached");
          }, 0);
        }

        return response;

      } catch (error) {
        console.error(`❌ [Worker ${workerId}] Request error:`, error);

        return new Response(`RIP Worker ${workerId} Error: ${error.message}`, {
          status: 500,
          headers: { "Content-Type": "text/plain" }
        });
      }
    },
  });

  /**
   * Graceful shutdown handler
   */
  const gracefulShutdown = (reason: string) => {
    if (isShuttingDown) return;

    isShuttingDown = true;
    console.log(`👋 [Worker ${workerId}] Graceful shutdown: ${reason}`);

    // Stop accepting new requests
    server.stop(false); // false = don't force, wait for current requests

    // Exit after a delay to ensure cleanup
    setTimeout(() => {
      console.log(`✅ [Worker ${workerId}] Shutdown complete`);
      process.exit(0);
    }, 100);
  };

  // Handle shutdown signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM received'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT received'));

  console.log(`🚀 [Worker ${workerId}] Ready on ${socketPath}`);
  console.log(`🎯 [Worker ${workerId}] Waiting for requests...`);
};

// Start the worker
main().catch(console.error);