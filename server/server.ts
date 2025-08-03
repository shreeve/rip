/**
 * 🌐 Rip Server - HTTP Server and Load Balancer
 *
 * High-performance HTTP server that load balances requests across Rip workers.
 * Uses Unix sockets for maximum performance and automatic failover.
 *
 * This is the FRONT-END of the architecture - clients connect here.
 *
 * Usage: bun server.ts [port] [numWorkers]
 */

// Configuration
const port = parseInt(process.argv[2]) || 3000;
const numWorkers = parseInt(process.argv[3]) || 3;

// Generate worker socket paths
const workerSocketPaths = Array.from({ length: numWorkers }, (_, i) =>
  `/tmp/rip_worker_${i}.sock`
);

let currentWorker = 0;
let totalRequests = 0;
const workerStats = new Map<string, { requests: number; errors: number }>();

// Initialize worker stats
workerSocketPaths.forEach(path => {
  workerStats.set(path, { requests: 0, errors: 0 });
});

/**
 * Health check endpoint
 */
const handleHealthCheck = (req: Request) => {
  const url = new URL(req.url);

  if (url.pathname === '/health') {
    const stats = {
      status: 'healthy',
      totalRequests,
      workers: numWorkers,
      workerStats: Object.fromEntries(workerStats),
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };

    return new Response(JSON.stringify(stats, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (url.pathname === '/metrics') {
    const metrics = [
      `# Rip Server Metrics`,
      `rip_total_requests ${totalRequests}`,
      `rip_workers_total ${numWorkers}`,
      `rip_uptime_seconds ${process.uptime()}`,
      ...Array.from(workerStats.entries()).map(([path, stats]) =>
        `rip_worker_requests{worker="${path}"} ${stats.requests}`
      ),
      ...Array.from(workerStats.entries()).map(([path, stats]) =>
        `rip_worker_errors{worker="${path}"} ${stats.errors}`
      )
    ].join('\n');

    return new Response(metrics, {
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  return null; // Not a health/metrics request
};

/**
 * Main HTTP server with load balancing
 */
const server = Bun.serve({
  port,
  async fetch(req) {
    totalRequests++;

    // Handle health check and metrics endpoints
    const healthResponse = handleHealthCheck(req);
    if (healthResponse) return healthResponse;

    const url = new URL(req.url);

    // Round-robin load balancing with automatic failover
    for (let attempts = 0; attempts < workerSocketPaths.length; attempts++) {
      const socketPath = workerSocketPaths[currentWorker];
      const nextWorker = (currentWorker + 1) % workerSocketPaths.length;
      currentWorker = nextWorker;

      const stats = workerStats.get(socketPath)!;

      try {
        // Forward request to worker via Unix socket
        const workerResponse = await fetch(`http://localhost${url.pathname}${url.search}`, {
          method: req.method,
          headers: req.headers,
          body: req.body,
          unix: socketPath,
        });

        // Update stats
        stats.requests++;

        return workerResponse;

      } catch (error) {
        // Update error stats
        stats.errors++;

        console.error(`⚠️ [Server] Worker ${socketPath} failed: ${error.message}`);

        // Try next worker (automatic failover)
        if (attempts === workerSocketPaths.length - 1) {
          // All workers failed
          console.error(`🚨 [Server] All ${workerSocketPaths.length} workers unavailable!`);

          return new Response(
            `🚨 Rip Server Error: All workers unavailable\n\nTried ${workerSocketPaths.length} workers, all failed.\nLast error: ${error.message}\n\nIs the manager running? (bun manager.ts)`,
            {
              status: 503,
              headers: { 'Content-Type': 'text/plain' }
            }
          );
        }

        // Continue to next worker (silent failover)
        continue;
      }
    }
  },
});

/**
 * Graceful shutdown
 */
const gracefulShutdown = (signal: string) => {
  console.log(`\n👋 [Server] Received ${signal}, shutting down gracefully...`);

  server.stop();

  setTimeout(() => {
    console.log(`✅ [Server] Shutdown complete`);
    process.exit(0);
  }, 1000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Startup messages
console.log(`🚀 Rip Server listening on http://localhost:${port}`);
console.log(`📊 Load balancing across ${workerSocketPaths.length} workers`);
console.log(`🏥 Health check: http://localhost:${port}/health`);
console.log(`📈 Metrics: http://localhost:${port}/metrics`);
console.log(`🌟 Server ready!`);
console.log(`\n🔗 Worker sockets:`);
workerSocketPaths.forEach((path, i) => {
  console.log(`   Worker ${i}: ${path}`);
});
console.log(``);