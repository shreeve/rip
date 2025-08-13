/**
 * 🌐 Rip Server - HTTP Server and Load Balancer
 *
 * High-performance HTTP server that load balances requests across Rip workers.
 * Features intelligent 503 failover for perfect sequential processing.
 */

import { join } from 'path';
import { scale } from './time';

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
  private useJsonLogs: boolean;

  constructor(port: number, appName: string, numWorkers: number, httpsConfig?: { httpsPort: number; cert: string; key: string }, jsonLogging: boolean = false) {
    this.port = port ?? null;
    this.appName = appName;
    this.numWorkers = numWorkers;
    this.httpsConfig = httpsConfig;
    this.useJsonLogs = jsonLogging;

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
    if (this.port) {
      this.server = Bun.serve({
        port: this.port,
        fetch: this.handleRequest.bind(this),
      });
    }

    if (this.httpsConfig) {
      const { httpsPort, cert, key } = this.httpsConfig;
      this.httpsServer = Bun.serve({
        port: httpsPort,
        tls: { cert, key },
        fetch: this.handleRequest.bind(this),
      });
      console.log(`✅ https://localhost:${httpsPort}`);
    }
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop();
    }
    if (this.httpsServer) {
      this.httpsServer.stop();
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

    // Load balance to workers (includes logging)
    return await this.loadBalanceRequest(req);
  }

  /**
   * Load balance request across workers with failover
   */
  private async loadBalanceRequest(req: Request): Promise<Response> {
    const startTime = performance.now();
    this.totalRequests++;

    // Try each worker in round-robin fashion with failover
    for (let attempt = 0; attempt < this.numWorkers; attempt++) {
      const socketPath = this.workerSocketPaths[this.currentWorker];
      const stats = this.workerStats.get(socketPath)!;

      try {
        // Forward request to worker via Unix socket
        const workerStart = performance.now();
        const response = await this.forwardToWorker(req, socketPath);
        const workerTime = performance.now() - workerStart;

        // Update stats
        stats.requests++;

        // Move to next worker for next request
        this.currentWorker = (this.currentWorker + 1) % this.numWorkers;

        // Add server headers
        const headers = new Headers(response.headers);
        headers.set('X-Rip-Worker', this.currentWorker.toString());
        headers.set('X-Rip-App', this.appName);
        const totalTime = performance.now() - startTime;
        headers.set('X-Response-Time', `${Math.round(totalTime)}ms`);

        const outResp = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers
        });

        // Structured, aligned console logging (screen mode)
        // Convert milliseconds to seconds for precise scaling
        this.logRequest(req, outResp, totalTime / 1000, workerTime / 1000);
        return outResp;

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
      unix: socketPath,
    });
  }

  /**
   * Pretty console logger with fixed-width timestamp and two duration slots
   */
  private logRequest(req: Request, res: Response, totalSeconds: number, workerSeconds: number): void {
    if (this.useJsonLogs) {
      const url = new URL(req.url);
      const len = res.headers.get('content-length');
      const type = (res.headers.get('content-type') || '').split(';')[0] || undefined;
      console.log(JSON.stringify({
        t: new Date().toISOString(),
        app: this.appName,
        method: (req as any).method || 'GET',
        path: url.pathname,
        status: res.status,
        totalSeconds,
        workerSeconds,
        type,
        length: len ? Number(len) : undefined,
      }));
      return;
    }
    const now = new Date();
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    const tzMin = now.getTimezoneOffset();
    const tzSign = tzMin <= 0 ? '+' : '-';
    const tzAbs = Math.abs(tzMin);
    const tzStr = `${tzSign}${String(Math.floor(tzAbs / 60)).padStart(2, '0')}${String(tzAbs % 60).padStart(2, '0')}`;

    const d1 = scale(totalSeconds, 's');
    const d2 = scale(workerSeconds, 's');
    const method = (req as any).method || 'GET';
    const url = new URL(req.url);
    const path = url.pathname;
    const status = res.status;
    const lenHeader = res.headers.get('content-length') || '';
    const len = lenHeader ? `${lenHeader}B` : '';
    const contentType = (res.headers.get('content-type') || '').split(';')[0] || '';
    const type = contentType.includes('/') ? contentType.split('/')[1] : contentType;

    console.log(`[${ts} ${tzStr} ${d1} ${d2}] ${method} ${path} → ${status} ${type} ${len}`);
  }

}