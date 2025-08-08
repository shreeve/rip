/**
 * 🌐 Rip Platform Controller - Simplified Dynamic Application Management
 *
 * A simplified version that works with our current single-process architecture.
 * Manages multiple Rip applications dynamically without complex process spawning.
 */

import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { RipManager } from './manager';
import { RipServer } from './server';

// Types
export interface AppConfig {
  name: string;
  directory: string;
  port: number;
  workers: number;
  status: 'deployed' | 'running' | 'stopped' | 'error';
  startedAt?: Date;
  error?: string;
}

export interface PlatformStats {
  totalApps: number;
  runningApps: number;
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
}

/**
 * Simplified Platform Controller
 */
export class RipPlatform {
  private apps = new Map<string, AppConfig>();
  private usedPorts = new Set<number>();
  private startTime = new Date();
  private platformPort: number;
  private manager: RipManager;
  private servers = new Map<string, RipServer>(); // appName -> server

  constructor(platformPort = 3000) {
    this.platformPort = platformPort;
    this.usedPorts.add(platformPort);
    this.manager = new RipManager();
  }

  /**
   * Start the platform controller
   */
  async start(): Promise<void> {
    console.log('🚀 Starting Rip Platform Controller...');
    console.log(`📊 Platform Dashboard: http://localhost:${this.platformPort}/platform`);
    console.log(`🔧 Management API: http://localhost:${this.platformPort}/api`);
    console.log('✨ Ready to deploy apps dynamically!');

    // Start the platform management server
    await this.startPlatformServer();
  }

  /**
   * Deploy a new application with multi-process support
   */
  async deployApp(name: string, directory: string, workers: number = 3): Promise<AppConfig> {
    // Validate app doesn't already exist
    if (this.apps.has(name)) {
      throw new Error(`App '${name}' is already deployed`);
    }

    // Validate app directory exists
    const absolutePath = resolve(directory);
    const indexPath = join(absolutePath, 'index.rip');

    if (!existsSync(indexPath)) {
      throw new Error(`No index.rip found in ${directory}`);
    }

    // Find available port
    let port = 3001;
    while (this.usedPorts.has(port)) {
      port++;
    }
    this.usedPorts.add(port);

    // Create app config
    const config: AppConfig = {
      name,
      directory: absolutePath,
      port,
      workers,
      status: 'deployed',
      startedAt: new Date()
    };

    this.apps.set(name, config);
    console.log(`✅ App '${name}' deployed with ${workers} workers (will run on port ${port})`);

    return config;
  }

  /**
   * Undeploy an application
   */
  async undeployApp(name: string): Promise<void> {
    const app = this.apps.get(name);
    if (!app) {
      throw new Error(`App '${name}' not found`);
    }

    // Stop the app if running
    await this.stopApp(name);

    // Remove from registry
    this.usedPorts.delete(app.port);
    this.apps.delete(name);
    console.log(`✅ App '${name}' undeployed`);
  }

  /**
   * Start a specific app with full multi-process architecture (concurrent support)
   */
  async startApp(name: string): Promise<void> {
    const app = this.apps.get(name);
    if (!app) {
      throw new Error(`App '${name}' not found`);
    }

    if (app.status === 'running') {
      console.log(`⚠️ App '${name}' is already running on port ${app.port}`);
      return;
    }

    try {
      console.log(`🚀 Starting app '${name}' with ${app.workers} workers on port ${app.port}...`);

      // Start workers via manager
      await this.manager.startApp(name, app.directory, app.workers);

      // Start HTTP server for load balancing on app's dedicated port
      const server = new RipServer(app.port, name, app.workers);
      await server.start();
      this.servers.set(name, server);

      // Update app status
      app.status = 'running';
      app.startedAt = new Date();

      console.log(`✅ App '${name}' started successfully`);
      console.log(`🌐 Available at: http://localhost:${app.port}`);

      // Show running apps summary
      const runningApps = this.getRunningApps();
      if (runningApps.length > 1) {
        console.log(`📊 Total running apps: ${runningApps.length}`);
        runningApps.forEach(runningApp => {
          console.log(`   • ${runningApp.name}: http://localhost:${runningApp.port} (${runningApp.workers} workers)`);
        });
      }
    } catch (error) {
      app.status = 'error';
      app.error = error instanceof Error ? error.message : String(error);
      console.error(`❌ Failed to start app '${name}':`, error);
      throw error;
    }
  }

  /**
   * Stop a specific app
   */
  async stopApp(name: string): Promise<void> {
    const app = this.apps.get(name);
    if (!app) {
      throw new Error(`App '${name}' not found`);
    }

    if (app.status !== 'running') {
      console.log(`⚠️ App '${name}' is not running`);
      return;
    }

    try {
      console.log(`🛑 Stopping app '${name}'...`);

      // Stop HTTP server
      const server = this.servers.get(name);
      if (server) {
        await server.stop();
        this.servers.delete(name);
      }

      // Stop workers via manager
      await this.manager.stopApp(name);

      // Update app status
      app.status = 'stopped';

      console.log(`✅ App '${name}' stopped`);
    } catch (error) {
      console.error(`❌ Failed to stop app '${name}':`, error);
      throw error;
    }
  }

  /**
   * List all deployed apps
   */
  listApps(): AppConfig[] {
    return Array.from(this.apps.values());
  }

  /**
   * Get platform statistics
   */
  getStats(): PlatformStats {
    const runningApps = Array.from(this.apps.values()).filter(app => app.status === 'running').length;

    return {
      totalApps: this.apps.size,
      runningApps,
      uptime: Date.now() - this.startTime.getTime(),
      memoryUsage: process.memoryUsage()
    };
  }

  /**
   * Get all running apps
   */
  getRunningApps(): AppConfig[] {
    return Array.from(this.apps.values()).filter(app => app.status === 'running');
  }

  /**
   * Get a specific app
   */
  getApp(name: string): App | undefined {
    return this.apps.get(name);
  }

  /**
   * Scale an app (change number of workers)
   */
  async scaleApp(name: string, workers: number): Promise<void> {
    const app = this.apps.get(name);
    if (!app) {
      throw new Error(`App '${name}' not found`);
    }

    if (app.status === 'running') {
      // Restart with new worker count
      await this.stopApp(name);
      app.workers = workers;
      await this.startApp(name);
    } else {
      // Just update the config
      app.workers = workers;
    }

    console.log(`✅ App '${name}' scaled to ${workers} workers`);
  }

  /**
   * Start the platform management server
   */
  private async startPlatformServer(): Promise<void> {
    // This will be integrated into our main server
    console.log('🌐 Platform server ready for integration');
  }
}