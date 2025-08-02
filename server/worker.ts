/**
 * RIP Worker - Request Handler
 *
 * Handles individual HTTP requests via Unix sockets.
 * Gracefully shuts down after reaching request limit to prevent memory leaks.
 *
 * Usage: bun worker.ts [workerId] [maxRequests]
 */

const workerId = process.argv[2] ?? "0";
const maxRequests = parseInt(process.argv[3] ?? "100");
let requestsHandled = 0;

const socketPath = `/tmp/rip_worker_${workerId}.sock`;

// Clean up any existing socket file
try {
  await Bun.unlink(socketPath);
} catch (_) {
  // Socket didn't exist, that's fine
}

const server = Bun.serve({
  unix: socketPath,
  async fetch(req) {
    requestsHandled++;

    if (requestsHandled >= maxRequests) {
      console.log(`✅ Worker ${workerId} reached ${maxRequests} requests. Shutting down gracefully.`);

      // Graceful shutdown - Bun waits for this request to complete
      server.stop(false);

      return new Response(`Hello from RIP worker ${workerId} (request #${requestsHandled}) - Final request`, {
        headers: { "Content-Type": "text/plain" }
      });
    }

    return new Response(`Hello from RIP worker ${workerId} (request #${requestsHandled})`, {
      headers: { "Content-Type": "text/plain" }
    });
  },
});

console.log(`🔥 RIP Worker ${workerId} listening on ${socketPath}`);
console.log(`📊 Will handle up to ${maxRequests} requests before restarting`);