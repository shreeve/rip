/**
 * 🌐 Rip Server - HTTP Server and Load Balancer
 *
 * High-performance HTTP server that load balances requests across Rip workers.
 * Features intelligent 503 failover for perfect sequential processing.
 */

import { join } from 'path';

export class RipServer {
  private port: number | null;
  private appName: string;
  private numWorkers: number;
  private workerSocketPaths: string[] = [];
  private currentWorker = 0;
  private totalRequests = 0;
  private workerStats = new Map<string, { requests: number; errors: number }>();
  private server: any = null;
  private httpsServer: any = null;
  private httpsConfig?: { httpsPort: number; cert: string; key: string };

  constructor(port: number, appName: string, numWorkers: number, httpsConfig?: { httpsPort: number; cert: string; key: string }) {
    this.port = port ?? null;
    this.appName = appName;
    this.numWorkers = numWorkers;
    this.httpsConfig = httpsConfig;

    // Generate worker socket paths
    this.workerSocketPaths = Array.from(
      { length: numWorkers },
      (_, i) => `/tmp/rip_worker_${appName}_${i}.sock`
    );

    // Initialize worker stats
    this.workerSocketPaths.forEach(path => {
      this.workerStats.set(path, { requests: 0, errors: 0 });
    });
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    console.log(`🔗 [Server] Load balancing across ${this.numWorkers} workers`);

    if (this.port) {
      console.log(`🚀 [Server] Starting HTTP server for app '${this.appName}' on port ${this.port}`);
      this.server = Bun.serve({
        port: this.port,
        fetch: this.handleRequest.bind(this),
      });
      console.log(`✅ [Server] HTTP server running at http://localhost:${this.port}`);
    }

    if (this.httpsConfig) {
      const { httpsPort, cert, key } = this.httpsConfig;
      console.log(`🚀 [Server] Starting HTTPS server for app '${this.appName}' on port ${httpsPort}`);
      this.httpsServer = Bun.serve({
        port: httpsPort,
        tls: { cert, key },
        fetch: this.handleRequest.bind(this),
      });
      console.log(`✅ [Server] HTTPS server running at https://localhost:${httpsPort}`);
    }
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop();
      console.log(`✅ [Server] HTTP server for app '${this.appName}' stopped`);
    }
    if (this.httpsServer) {
      this.httpsServer.stop();
      console.log(`✅ [Server] HTTPS server for app '${this.appName}' stopped`);
    }
  }

  /**
   * Handle incoming HTTP request with load balancing
   */
  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        app: this.appName,
        workers: this.numWorkers,
        totalRequests: this.totalRequests,
        workerStats: Object.fromEntries(this.workerStats)
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Metrics endpoint
    if (url.pathname === '/metrics') {
      return new Response(JSON.stringify({
        app: this.appName,
        totalRequests: this.totalRequests,
        workers: this.numWorkers,
        workerStats: Object.fromEntries(this.workerStats)
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Load balance to workers
    return await this.loadBalanceRequest(req);
  }

  /**
   * Load balance request across workers with failover
   */
  private async loadBalanceRequest(req: Request): Promise<Response> {
    const startTime = Date.now();
    this.totalRequests++;

    // Try each worker in round-robin fashion with failover
    for (let attempt = 0; attempt < this.numWorkers; attempt++) {
      const socketPath = this.workerSocketPaths[this.currentWorker];
      const stats = this.workerStats.get(socketPath)!;

      try {
        // Forward request to worker via Unix socket
        const response = await this.forwardToWorker(req, socketPath);

        // Update stats
        stats.requests++;

        // Move to next worker for next request
        this.currentWorker = (this.currentWorker + 1) % this.numWorkers;

        // Add server headers
        const headers = new Headers(response.headers);
        headers.set('X-Rip-Worker', this.currentWorker.toString());
        headers.set('X-Rip-App', this.appName);
        headers.set('X-Response-Time', `${Date.now() - startTime}ms`);

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers
        });

      } catch (error) {
        console.warn(`⚠️ [Server] Worker ${this.currentWorker} failed, trying next worker:`, error);

        // Update error stats
        stats.errors++;

        // Try next worker
        this.currentWorker = (this.currentWorker + 1) % this.numWorkers;
      }
    }

    // All workers failed
    console.error(`❌ [Server] All workers failed for app '${this.appName}'`);
    return new Response('All workers unavailable', { status: 503 });
  }

      /**
   * Forward request to a specific worker via Unix socket
   */
  private async forwardToWorker(req: Request, socketPath: string): Promise<Response> {
    // Rebuild URL for unix socket forwarding (scheme/host don't matter)
    const inUrl = new URL(req.url);
    const forwardUrl = `http://localhost${inUrl.pathname}${inUrl.search}`;
    return await fetch(forwardUrl, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      unix: socketPath, // This is all we need!
    });
  }

  /**
   * Get server statistics
   */
  getStats(): any {
    return {
      app: this.appName,
      port: this.port,
      workers: this.numWorkers,
      totalRequests: this.totalRequests,
      workerStats: Object.fromEntries(this.workerStats)
    };
  }
}