/**
 * 🌐 Rip Platform Controller - Simplified Dynamic Application Management
 * 
 * A simplified version that works with our current single-process architecture.
 * Manages multiple Rip applications dynamically without complex process spawning.
 */

import { existsSync } from 'fs';
import { join, resolve } from 'path';

// Types
export interface AppConfig {
  name: string;
  directory: string;
  port: number;
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
  private currentApp: AppConfig | null = null;
  private currentServer: any = null;

  constructor(platformPort = 3000) {
    this.platformPort = platformPort;
    this.usedPorts.add(platformPort);
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
   * Deploy a new application (simplified - just register it)
   */
  async deployApp(name: string, directory: string): Promise<AppConfig> {
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
      status: 'deployed',
      startedAt: new Date()
    };

    this.apps.set(name, config);
    console.log(`✅ App '${name}' deployed (will run on port ${port})`);
    
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

    // Stop if currently running
    if (this.currentApp?.name === name) {
      await this.stopCurrentApp();
    }

    // Remove from registry
    this.usedPorts.delete(app.port);
    this.apps.delete(name);
    console.log(`✅ App '${name}' undeployed`);
  }

  /**
   * Start a specific app (simplified - single app at a time for now)
   */
  async startApp(name: string): Promise<void> {
    const app = this.apps.get(name);
    if (!app) {
      throw new Error(`App '${name}' not found`);
    }

    // Stop current app if running
    if (this.currentApp) {
      await this.stopCurrentApp();
    }

    // Load and start the app
    console.log(`🚀 Starting app '${name}'...`);
    console.log(`📁 Loading: ${app.directory}/index.rip`);

    try {
      const indexPath = join(app.directory, 'index.rip');
      let ripApp = await import(indexPath);
      ripApp = ripApp.default || ripApp;

      // Update app status
      app.status = 'running';
      app.startedAt = new Date();
      this.currentApp = app;

      console.log(`✅ App '${name}' started successfully`);
      return ripApp;
    } catch (error) {
      app.status = 'error';
      app.error = error instanceof Error ? error.message : String(error);
      console.error(`❌ Failed to start app '${name}':`, error);
      throw error;
    }
  }

  /**
   * Stop the currently running app
   */
  async stopCurrentApp(): Promise<void> {
    if (this.currentApp) {
      console.log(`🛑 Stopping app '${this.currentApp.name}'...`);
      this.currentApp.status = 'stopped';
      this.currentApp = null;
      console.log('✅ App stopped');
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
   * Get the currently running app
   */
  getCurrentApp(): AppConfig | null {
    return this.currentApp;
  }

  /**
   * Start the platform management server
   */
  private async startPlatformServer(): Promise<void> {
    // This will be integrated into our main server
    console.log('🌐 Platform server ready for integration');
  }
}