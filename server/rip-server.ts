#!/usr/bin/env bun

/**
 * 🚀 Rip Server - Pure TypeScript Implementation
 * No more shell scripts, no more spawn issues!
 */

import { spawn } from "bun";
import { join, resolve } from "path";
import { existsSync } from "fs";

const SCRIPT_DIR = import.meta.dir;

// Parse command line arguments
const [, , command = "help", ...args] = process.argv;

// Helper to kill all rip processes
async function killAll() {
  console.log("🛑 Stopping all rip-server processes...");
  const proc = spawn(["pkill", "-f", "manager.ts|worker.ts|server.ts"], {
    stdout: "pipe",
    stderr: "pipe"
  });
  await proc.exited;
  console.log("✅ All processes stopped");
}

// Start command
async function start(mode: string = "dev", foreground: string = "true", appDir: string = process.cwd()) {
  const appPath = resolve(appDir);

  // Verify app directory exists
  if (!existsSync(appPath)) {
    console.error(`❌ App directory not found: ${appPath}`);
    process.exit(1);
  }

  // Check for index.ts or index.rip
  const hasIndex = existsSync(join(appPath, "index.ts")) || existsSync(join(appPath, "index.rip"));
  if (!hasIndex) {
    console.error(`❌ No index.ts or index.rip found in: ${appPath}`);
    process.exit(1);
  }

  console.log(`
🌐 Endpoints:
   📡 HTTP:    http://localhost:3000
   🏥 Health:  http://localhost:3000/health
   📈 Metrics: http://localhost:3000/metrics

🔥 Hot Reload: ${appPath}

🛑 Press Ctrl-C to stop
`);

  // Start manager
  console.log("Starting manager...");
  const manager = spawn([
    "bun",
    join(SCRIPT_DIR, "manager.ts"),
    "0",
    "3",
    "10",
    appPath
  ], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit"
  });

  // Monitor manager
  manager.exited.then((code) => {
    console.error(`Manager exited with code ${code}`);
    process.exit(1);
  });

  // Wait for workers to start
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Start server
  console.log("Starting server...");
  const server = spawn([
    "bun",
    join(SCRIPT_DIR, "server.ts"),
    "0",
    "3000",
    "3"
  ], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit"
  });

  // Monitor server
  server.exited.then((code) => {
    console.error(`Server exited with code ${code}`);
    process.exit(1);
  });

  // Handle shutdown
  process.on("SIGINT", async () => {
    console.log("\n🛑 Shutting down...");
    manager.kill();
    server.kill();
    await killAll();
    process.exit(0);
  });

  // Keep running
  if (foreground === "true") {
    // Wait forever
    await new Promise(() => {});
  } else {
    // Background mode - wait a bit then check health
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      const response = await fetch("http://localhost:3000/health");
      if (response.ok) {
        console.log("✅ Server launched successfully!");
        console.log("🛑 Stop with: rip-server stop");
      } else {
        throw new Error("Health check failed");
      }
    } catch (e) {
      console.error("❌ Server failed to start");
      await killAll();
      process.exit(1);
    }
  }
}

// Main command handler
switch (command) {
  case "start":
  case "dev":
  case "prod":
    const mode = command === "start" ? args[0] || "dev" : command;
    const foreground = args[command === "start" ? 1 : 0] || "true";
    const appDir = args[command === "start" ? 2 : 1] || process.cwd();
    await start(mode, foreground, appDir);
    break;

  case "stop":
    await killAll();
    break;

  case "test":
    console.log("🧪 Running tests...");
    const test = spawn(["bun", "test", "--timeout", "20000"], {
      cwd: SCRIPT_DIR,
      stdout: "inherit",
      stderr: "inherit"
    });
    const testCode = await test.exited;
    process.exit(testCode);
    break;

  case "help":
  case "-h":
  case "--help":
    console.log(`🚀 Rip Application Server

Usage:
  rip-server start [mode] [foreground] [app_dir]
  rip-server dev   [foreground] [app_dir]
  rip-server prod  [foreground] [app_dir]
  rip-server stop
  rip-server test

Examples:
  rip-server dev                    # Start development server
  rip-server dev true ./api         # Dev server with specific app
  rip-server stop                   # Stop all processes
  rip-server test                   # Run test suite

🔥 Pure TypeScript, no shell scripts, no spawn issues!`);
    break;

  default:
    // Default to dev mode
    await start("dev", args[0] || "true", args[1] || process.cwd());
}