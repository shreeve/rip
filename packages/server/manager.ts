/**
 * 🚀 Rip Manager - Multi-Process Manager for Platform Apps
 *
 * Manages worker processes for deployed platform applications.
 * Integrates with our Platform Controller for dynamic app management.
 */

import { watch } from 'fs';
import { join, resolve } from 'path';
import { existsSync } from 'fs';

// Worker tracking
interface Worker {
  process: any; // Bun.Subprocess type
  id: number;
  restartCount: number;
  socketPath: string;
  startedAt: number;
  backoffMs: number;
  appName: string;
}

export class RipManager {
  private workers: Map<string, Worker[]> = new Map(); // appName -> workers
  private appDirectories: Map<string, string> = new Map(); // appName -> directory
  private appMaxRequests: Map<string, number> = new Map(); // appName -> maxRequestsPerWorker
  private appJsonLogging: Map<string, boolean> = new Map(); // appName -> json logging flag
  private isShuttingDown = false;
  private fileWatchingEnabled = true;
  private watchers: Map<string, any> = new Map(); // appName -> file watcher
  private reloadTimers: Map<string, NodeJS.Timeout> = new Map(); // appName -> debounce timer

  constructor() {
    this.setupGracefulShutdown();
  }

  /**
   * Start workers for a specific app
   */
  async startApp(appName: string, appDirectory: string, numWorkers: number = 3, maxRequestsPerWorker: number = 100, jsonLogging: boolean = false): Promise<void> {
    console.log(`🚀 [Manager] Starting ${numWorkers} workers for app '${appName}'`);

    // Resolve absolute path
    const absolutePath = resolve(appDirectory);

    if (!existsSync(absolutePath)) {
      throw new Error(`App directory not found: ${appDirectory}`);
    }

    // Stop existing workers if any
    await this.stopApp(appName);

    // Store app directory for hot reload restarts
    this.appDirectories.set(appName, absolutePath);
    this.appMaxRequests.set(appName, maxRequestsPerWorker);
    this.appJsonLogging.set(appName, jsonLogging);

    // Create worker array for this app
    this.workers.set(appName, []);

    // Start workers
    const workers: Worker[] = [];
    for (let i = 0; i < numWorkers; i++) {
      const worker = await this.spawnWorker(appName, i, maxRequestsPerWorker, absolutePath, jsonLogging);
      workers.push(worker);
    }

    this.workers.set(appName, workers);

    // Setup file watching for hot reload
    if (this.fileWatchingEnabled) {
      this.setupFileWatching(appName, absolutePath);
    }

    console.log(`✅ [Manager] App '${appName}' started with ${numWorkers} workers`);
  }

  /**
   * Stop workers for a specific app
   */
  async stopApp(appName: string): Promise<void> {
    const workers = this.workers.get(appName);
    if (!workers || workers.length === 0) {
      return;
    }

    console.log(`🛑 [Manager] Stopping workers for app '${appName}'`);

    // Stop file watching
    const watcher = this.watchers.get(appName);
    if (watcher) {
      watcher.close();
      this.watchers.delete(appName);
    }

    // Clear any pending reload timers
    const timer = this.reloadTimers.get(appName);
    if (timer) {
      clearTimeout(timer);
      this.reloadTimers.delete(appName);
    }

    // Terminate workers
    for (const worker of workers) {
      try {
        worker.process.kill();
        await worker.process.exited;

        // Clean up socket
        try {
          await Bun.spawn(['rm', '-f', worker.socketPath]).exited;
        } catch (_) {
          // Socket cleanup failed, continue
        }
      } catch (error) {
        console.error(`❌ [Manager] Error stopping worker ${worker.id}:`, error);
      }
    }

    this.workers.delete(appName);
    this.appDirectories.delete(appName);
    console.log(`✅ [Manager] App '${appName}' stopped`);
  }

  /**
   * Get status of all managed apps
   */
  getStatus(): { [appName: string]: { workers: number; status: string } } {
    const status: { [appName: string]: { workers: number; status: string } } = {};

    for (const [appName, workers] of this.workers) {
      const activeWorkers = workers.filter(w => !w.process.killed).length;
      status[appName] = {
        workers: activeWorkers,
        status: activeWorkers > 0 ? 'running' : 'stopped'
      };
    }

    return status;
  }

  /**
   * Spawn a single worker process
   */
  private async spawnWorker(appName: string, workerId: number, maxRequestsPerWorker: number, appDirectory: string, jsonLogging: boolean): Promise<Worker> {
    const socketPath = `/tmp/rip_worker_${appName}_${workerId}.sock`;

    // Clean up any existing socket
    try {
      await Bun.spawn(['rm', '-f', socketPath]).exited;
    } catch (_) {
      // Socket didn't exist, that's fine
    }

    // Spawn worker process
    const workerProcess = Bun.spawn(
      [
        'bun',
        '--preload', './packages/bun/rip-bun.ts', // Ensure Rip transpiler is loaded
        join(__dirname, 'worker.ts'),
        workerId.toString(),
        maxRequestsPerWorker.toString(),
        appDirectory,
        appName
      ],
      {
        stdout: 'pipe', // Capture output for logging
        stderr: 'pipe',
        stdin: 'ignore',
        cwd: process.cwd(), // Keep in monorepo root for proper path resolution
        env: {
          ...process.env,
          WORKER_ID: workerId.toString(),
          APP_NAME: appName,
        SOCKET_PATH: socketPath,
        RIP_LOG_JSON: jsonLogging ? '1' : '0'
        },
      }
    );

    const worker: Worker = {
      process: workerProcess,
      id: workerId,
      restartCount: 0,
      socketPath,
      startedAt: Date.now(),
      backoffMs: 1000, // Start with 1 second backoff
      appName
    };

    // Monitor worker process
    this.monitorWorker(worker);

    return worker;
  }

  /**
   * Monitor worker process for crashes and restarts
   */
  private monitorWorker(worker: Worker): void {
    worker.process.exited.then(async (exitCode: number) => {
      if (this.isShuttingDown) return;

          const workers = this.workers.get(worker.appName);
      if (!workers) return;

      console.log(`⚠️ [Manager] Worker ${worker.id} for app '${worker.appName}' exited with code ${exitCode}`);

      // Implement exponential backoff for restarts
      worker.restartCount++;
      worker.backoffMs = Math.min(worker.backoffMs * 2, 30000); // Cap at 30 seconds

      if (worker.restartCount > 10) {
        console.error(`❌ [Manager] Worker ${worker.id} for app '${worker.appName}' has crashed too many times, not restarting`);
        return;
      }

      // Wait for backoff period
      setTimeout(async () => {
        try {
          console.log(`🔄 [Manager] Restarting worker ${worker.id} for app '${worker.appName}' (attempt ${worker.restartCount})`);

          // Find the worker in the array and replace it
          const workerIndex = workers.findIndex(w => w.id === worker.id);
          if (workerIndex >= 0) {
            // Get the app directory from the appDirectories map
            const appDirectory = this.appDirectories.get(worker.appName) || worker.appName;
            const maxReq = this.appMaxRequests.get(worker.appName) ?? 100;
            const json = this.appJsonLogging.get(worker.appName) ?? false;
            const newWorker = await this.spawnWorker(
              worker.appName,
              worker.id,
              maxReq,
              appDirectory,
              json
            );
            workers[workerIndex] = newWorker;
          }
        } catch (error) {
          console.error(`❌ [Manager] Failed to restart worker ${worker.id}:`, error);
        }
      }, worker.backoffMs);
    });
  }

  /**
   * Setup file watching for hot reload
   */
  private setupFileWatching(appName: string, appDirectory: string): void {
    try {
      const watcher = watch(appDirectory, { recursive: true }, (eventType, filename) => {
        if (!filename || !filename.endsWith('.rip')) return;

        console.log(`🔥 [Manager] File change detected for app '${appName}': ${filename}`);

        // Debounce rapid file changes (e.g., editor saves)
        const existingTimer = this.reloadTimers.get(appName);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }

        const timer = setTimeout(() => {
          console.log(`🔄 [Manager] Hot reload triggered for app '${appName}' after debounce`);
          this.restartAppWorkers(appName);
          this.reloadTimers.delete(appName);
        }, 500); // 500ms debounce

        this.reloadTimers.set(appName, timer);
      });

      this.watchers.set(appName, watcher);
      console.log(`👁️ [Manager] File watching enabled for app '${appName}' in ${appDirectory}`);
    } catch (error) {
      console.error(`❌ [Manager] Failed to setup file watching for app '${appName}':`, error);
    }
  }

  /**
   * Restart all workers for an app (hot reload)
   */
  private async restartAppWorkers(appName: string): Promise<void> {
    const workers = this.workers.get(appName);
    if (!workers) return;

    console.log(`🔄 [Manager] Hot reloading ALL workers for app '${appName}' (immediate cutover)`);

    // Kill all workers quickly to ensure no stale responses
    await Promise.all(workers.map(async (worker) => {
      try {
        worker.process.kill('SIGTERM');
        try { await worker.process.exited; } catch {}
      } catch (error) {
        console.error(`❌ [Manager] Error stopping worker ${worker.id}:`, error);
      }
    }));

    // monitorWorker will automatically respawn each with same id
    console.log(`✅ [Manager] All workers terminated; new workers will start immediately`);
  }

  /**
   * Setup graceful shutdown
   */
  private setupGracefulShutdown(): void {
    const shutdown = async () => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      console.log('🛑 [Manager] Graceful shutdown initiated...');

      // Stop all apps
      const appNames = Array.from(this.workers.keys());
      for (const appName of appNames) {
        await this.stopApp(appName);
      }

      console.log('✅ [Manager] Shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
}