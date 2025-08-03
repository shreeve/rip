/**
 * 🌐 Rip Server - HTTP Server and Load Balancer
 *
 * High-performance HTTP server that load balances requests across Rip workers.
 * Features intelligent 503 failover for perfect sequential processing.
 *
 * Key Features:
 * - Round-robin load balancing with automatic worker failover
 * - Intelligent 503 handling: busy worker → try next worker
 * - Unix sockets for maximum performance
 * - Health checks and metrics endpoints
 * - Perfect isolation support for sequential processing
 *
 * This is the FRONT-END of the architecture - clients connect here.
 *
 * Usage: bun server.ts [port] [numWorkers] [httpsPort] [certPath] [keyPath]
 */

// Configuration
const port = parseInt(process.argv[2]) || 3000;
const numWorkers = parseInt(process.argv[3]) || 3;
const httpsPort = parseInt(process.argv[4]) || 3443;
const certPath = process.argv[5]; // Optional: path to SSL certificate
const keyPath = process.argv[6];  // Optional: path to SSL private key

// HTTPS Configuration
const httpsEnabled = certPath && keyPath;
let cert: string | undefined;
let key: string | undefined;

if (httpsEnabled) {
  try {
    cert = await Bun.file(certPath).text();
    key = await Bun.file(keyPath).text();
    console.log(`🔒 [Server] HTTPS enabled with cert: ${certPath}`);
  } catch (error) {
    console.error(`❌ [Server] Failed to load HTTPS certificates: ${error}`);
    console.error(`   Cert path: ${certPath}`);
    console.error(`   Key path: ${keyPath}`);
    process.exit(1);
  }
}

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
 * Shared request handler for both HTTP and HTTPS
 */
const handleRequest = async (req: Request) => {
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

        // 🎯 Intelligent 503 Failover: If worker is busy, try next worker
        if (workerResponse.status === 503) {
          console.log(`⏸️ [Server] Worker ${socketPath} busy (503) - trying next worker...`);

          // Don't return yet, let the loop try the next worker
          continue;
        }

        // Worker available - return the response
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

    // 🚨 All workers are busy - return 503 to client
    console.warn(`🚨 [Server] All ${workerSocketPaths.length} workers are busy - returning 503 to client`);
    return new Response(
      `🚨 All Workers Busy\n\nAll ${workerSocketPaths.length} workers are currently processing requests.\nThis ensures perfect isolation - please retry in a moment.\n\nTip: Each worker processes one request at a time for maximum reliability.`,
      {
        status: 503,
        headers: {
          'Content-Type': 'text/plain',
          'Retry-After': '1'
        }
      }
    );
};

/**
 * Create HTTP and HTTPS servers
 */
const servers: any[] = [];

// HTTP Server
const httpServer = Bun.serve({
  port,
  fetch: handleRequest,
});
servers.push(httpServer);

// HTTPS Server (if certificates provided)
let httpsServer: any = null;
if (httpsEnabled && cert && key) {
  httpsServer = Bun.serve({
    port: httpsPort,
    fetch: handleRequest,
    tls: {
      cert,
      key,
    },
  });
  servers.push(httpsServer);
}

/**
 * Graceful shutdown
 */
const gracefulShutdown = (signal: string) => {
  // Stop all servers
  servers.forEach(server => {
    if (server) {
      server.stop();
    }
  });

  setTimeout(() => {
    process.exit(0);
  }, 1000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Startup messages
console.log(`🚀 Rip Server listening on:`);
console.log(`   📡 HTTP:  http://localhost:${port}`);
if (httpsEnabled) {
  console.log(`   🔒 HTTPS: https://localhost:${httpsPort}`);
}
console.log(`📊 Load balancing across ${workerSocketPaths.length} workers`);
console.log(`🏥 Health check: http://localhost:${port}/health`);
console.log(`📈 Metrics: http://localhost:${port}/metrics`);
if (httpsEnabled) {
  console.log(`🔒 Secure endpoints: https://localhost:${httpsPort}/health, https://localhost:${httpsPort}/metrics`);
}
console.log(`🌟 Server ready! ${httpsEnabled ? '(HTTP + HTTPS)' : '(HTTP only)'}`);
console.log(`\n🔗 Worker sockets:`);
workerSocketPaths.forEach((path, i) => {
  console.log(`   Worker ${i}: ${path}`);
});
console.log(``);