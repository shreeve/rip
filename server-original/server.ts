/**
 * RIP Server - HTTP Server & Load Balancer
 *
 * Routes incoming HTTP requests to available worker processes via Unix sockets.
 * Provides automatic failover and round-robin load balancing.
 *
 * Usage: bun server.ts
 * Access: http://localhost:3000
 */

const workerSocketPaths = [
  "/tmp/rip_worker_0.sock",
  "/tmp/rip_worker_1.sock",
  "/tmp/rip_worker_2.sock",
];

let currentWorker = 0;

Bun.serve({
  port: 3000, // HTTP server port - receives requests from clients
  async fetch(req) {
    const url = new URL(req.url);

    // Round-robin load balancing with automatic failover
    // Try each worker socket until one succeeds
    for (let attempts = 0; attempts < workerSocketPaths.length; attempts++) {
      const socket = workerSocketPaths[currentWorker];
      currentWorker = (currentWorker + 1) % workerSocketPaths.length;

      try {
        const workerResponse = await fetch(`http://localhost${url.pathname}${url.search}`, {
          method:  req.method,
          headers: new Headers(req.headers),
          body:    req.body,
          unix:    socket,
          verbose: true,
        });

        return workerResponse;
      } catch (error) {
        // Only log if all workers fail, not individual fallback attempts
        if (attempts === workerSocketPaths.length - 1) {
          console.error(`🚨 All worker sockets unavailable. Last error: ${error.message}`);
          throw new Error(`All worker sockets unavailable. Last error: ${error.message}`);
        }

        // Silent fallback to next worker
        continue;
      }
    }
  },
});

console.log("🚀 RIP Server listening at http://localhost:3000");
console.log(`📊 Load balancing across ${workerSocketPaths.length} workers`);