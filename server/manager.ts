/**
 * RIP Manager - Process Manager
 *
 * Spawns and manages worker processes for the RIP server.
 * Automatically restarts workers when they exit to ensure high availability.
 *
 * Usage: bun manager.ts
 */

const numWorkers = 3;
const maxRequestsPerWorker = 5; // For stress testing - set higher for production

const spawnWorker = (workerId: number) => {
  console.log(`🚀 Spawning worker ${workerId}...`);

  const process = Bun.spawn(["bun", "worker.ts", workerId.toString(), maxRequestsPerWorker.toString()], {
    stdout: "inherit",
    stderr: "inherit"
  });

  process.exited.then(({ code }) => {
    console.log(`⚡ Worker ${workerId} exited with code ${code}. Respawning immediately...`);
    // Immediate restart to minimize downtime gap
    spawnWorker(workerId);
  });
};

console.log(`🎯 RIP Manager starting ${numWorkers} workers...`);
console.log(`📈 Max requests per worker: ${maxRequestsPerWorker}`);

for (let i = 0; i < numWorkers; i++) {
  spawnWorker(i);
}

console.log("🔥 RIP Manager running - workers will restart automatically");