/**
 * 🚀 Rip Manager - Process Manager + Hot Reload
 *
 * This is where the MAGIC happens! Combines:
 * - Multi-process worker management (like Unicorn)
 * - File watching for hot reload (like our rip-server.js)
 * - Graceful worker restarts (production-safe)
 * - Emergency production hot-fixes
 *
 * Usage: bun manager.ts [numWorkers] [maxRequestsPerWorker]
 */

import { watch } from "fs";
import { join } from "path";

// Configuration
const numWorkers = parseInt(process.argv[2]) || 3;
const maxRequestsPerWorker = parseInt(process.argv[3]) || (process.env.NODE_ENV === "production" ? 1000 : 10);
const appDirectory = process.argv[4] || process.cwd();

// Worker tracking
interface Worker {
  process: any;
  id: number;
  restartCount: number;
  socketPath: string;
}

const workers: Worker[] = [];
let isShuttingDown = false;
let fileWatchingEnabled = true;

/**
 * Spawn a single worker process
 */
const spawnWorker = async (workerId: number): Promise<Worker> => {
  const socketPath = `/tmp/rip_worker_${workerId}.sock`;

  console.log(`🚀 [Manager] Spawning worker ${workerId}... (restart #${workers[workerId]?.restartCount || 1})`);

  // Clean up any existing socket
  try {
    await Bun.unlink(socketPath);
  } catch (_) {
    // Socket didn't exist, that's fine
  }

  const process = Bun.spawn([
    "bun",
    join(__dirname, "worker.ts"),
    workerId.toString(),
    maxRequestsPerWorker.toString(),
    appDirectory
  ], {
    stdout: "inherit",
    stderr: "inherit",
    cwd: appDirectory
  });

  const worker: Worker = {
    process,
    id: workerId,
    restartCount: (workers[workerId]?.restartCount || 0) + 1,
    socketPath
  };

  // Handle worker exit
  process.exited.then(({ code }) => {
    if (!isShuttingDown) {
      console.log(`⚡ [Manager] Worker ${workerId} exited with code ${code}. Respawning...`);

      // Small delay to prevent rapid restart loops
      setTimeout(() => {
        if (!isShuttingDown) {
          spawnWorker(workerId).then(newWorker => {
            workers[workerId] = newWorker;
          });
        }
      }, 100);
    }
  });

  return worker;
};

/**
 * Gracefully restart a specific worker
 */
const gracefulRestartWorker = async (workerId: number) => {
  const worker = workers[workerId];
  if (!worker) return;

  console.log(`🔄 [Manager] Graceful restart of worker ${workerId}...`);

  // Send SIGTERM for graceful shutdown
  worker.process.kill("SIGTERM");

  // Wait for exit, then spawn will handle restart automatically
  // The worker will finish current requests before shutting down
};

/**
 * Gracefully restart all workers (rolling restart)
 */
const gracefulRestartAllWorkers = async (reason: string) => {
  console.log(`🔄 [Manager] Rolling restart of all workers: ${reason}`);

  // Restart workers one by one to maintain availability
  for (let i = 0; i < workers.length; i++) {
    if (!isShuttingDown) {
      await gracefulRestartWorker(i);

      // Small delay between restarts to ensure availability
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log(`✅ [Manager] Rolling restart complete`);
};

/**
 * Initialize all workers
 */
const initializeWorkers = async () => {
  console.log(`🎯 [Manager] Starting ${numWorkers} workers...`);
  console.log(`📈 [Manager] Max requests per worker: ${maxRequestsPerWorker}`);
  console.log(`📁 [Manager] App directory: ${appDirectory}`);

  for (let i = 0; i < numWorkers; i++) {
    const worker = await spawnWorker(i);
    workers[i] = worker;

    // Small delay between worker starts
    await new Promise(resolve => setTimeout(resolve, 200));
  }
};

/**
 * File watcher for hot reload
 */
const setupFileWatcher = () => {
  if (!fileWatchingEnabled) return;

  console.log("👀 [Manager] Setting up file watcher for hot reload...");

  const watcher = watch(appDirectory, { recursive: true }, (eventType, filename) => {
    if (filename && filename.endsWith('.rip') && eventType === 'change') {
      console.log(`📁 [Manager] Rip file changed: ${filename}`);

      // Graceful rolling restart of all workers
      gracefulRestartAllWorkers(`File change: ${filename}`);
    }
  });

  // Handle cleanup
  process.on('SIGINT', () => {
    watcher.close();
  });

  process.on('SIGTERM', () => {
    watcher.close();
  });

  console.log(`🔥 [Manager] File watching active on: ${appDirectory}`);
};

/**
 * Handle graceful shutdown
 */
const setupGracefulShutdown = () => {
  const shutdown = (signal: string) => {
    console.log(`\n👋 [Manager] Received ${signal}, shutting down gracefully...`);
    isShuttingDown = true;
    fileWatchingEnabled = false;

    // Send SIGTERM to all workers
    workers.forEach((worker, id) => {
      if (worker?.process) {
        console.log(`🛑 [Manager] Stopping worker ${id}...`);
        worker.process.kill("SIGTERM");
      }
    });

    // Force exit after timeout
    setTimeout(() => {
      console.log(`💥 [Manager] Force exit after timeout`);
      process.exit(1);
    }, 10000);

    // Wait for all workers to exit
    Promise.all(
      workers.map(worker => worker?.process?.exited || Promise.resolve())
    ).then(() => {
      console.log(`✅ [Manager] All workers stopped. Exiting.`);
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
};

/**
 * Main initialization
 */
const main = async () => {
  console.log(`🚀 [Manager] Rip Manager starting...`);
  console.log(`🌍 [Manager] Environment: ${process.env.NODE_ENV || 'development'}`);

  // Setup graceful shutdown first
  setupGracefulShutdown();

  // Initialize workers
  await initializeWorkers();

  // Setup file watching for hot reload
  setupFileWatcher();

  console.log(`🎉 [Manager] Rip Manager ready!`);
  console.log(`🔥 [Manager] Managing ${numWorkers} workers with hot reload capability`);
  console.log(`🌟 [Manager] Server ready!`);
};

// Fire it up!
main().catch(console.error);