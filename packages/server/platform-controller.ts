/**
 * 🌐 Rip Platform Controller - Dynamic Application Management
 *
 * Dynamic application platform that allows deploying, scaling,
 * and managing multiple Rip applications from a single server instance.
 *
 * Think: Heroku/Railway but running locally with native process performance.
 *
 * Key Features:
 * - Dynamic app deployment/undeployment
 * - Real-time scaling (add/remove workers)
 * - Automatic port management
 * - Unified monitoring and logging
 * - Hot deployment without downtime
 * - Web dashboard for visual management
 */

import { existsSync } from 'fs'
import { join } from 'path'
import { type Subprocess, spawn } from 'bun'

// Types
export interface AppConfig {
  name: string
  directory: string
  port: number
  workers: number
  mode: 'dev' | 'prod'
  protocol: 'http' | 'https' | 'http+https'
  httpsPort?: number
  certPath?: string
  keyPath?: string
  env?: Record<string, string>
}

export interface AppInstance {
  config: AppConfig
  manager?: Subprocess
  server?: Subprocess
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error'
  startedAt: Date
  pid?: number
  error?: string
}

export interface PlatformStats {
  totalApps: number
  runningApps: number
  totalWorkers: number
  uptime: number
  memoryUsage: NodeJS.MemoryUsage
}

/**
 * Main Platform Controller Class
 */
export class RipPlatform {
  private apps = new Map<string, AppInstance>()
  private usedPorts = new Set<number>()
  private startTime = new Date()
  private platformPort: number

  constructor(platformPort = 3000) {
    this.platformPort = platformPort
    this.usedPorts.add(platformPort) // Reserve platform port
  }

  /**
   * Start the platform controller
   */
  async start(): Promise<void> {
    console.log('🚀 Starting Rip Platform Controller...')
    console.log(
      `📊 Platform Dashboard: http://localhost:${this.platformPort}/platform`,
    )
    console.log(`🔧 Management API: http://localhost:${this.platformPort}/api`)
    console.log('✨ Ready to deploy apps dynamically!')

    // Start the platform management server
    await this.startPlatformServer()
  }

  /**
   * Deploy a new application
   */
  async deployApp(
    config: Partial<AppConfig> & { name: string; directory: string },
  ): Promise<AppInstance> {
    const appName = config.name

    // Validate app doesn't already exist
    if (this.apps.has(appName)) {
      throw new Error(`App '${appName}' is already deployed`)
    }

    // Validate app directory exists
    if (!existsSync(config.directory)) {
      throw new Error(`App directory not found: ${config.directory}`)
    }

    // Check for valid entry points
    const possibleEntryPoints = [
      'index.rip',
      'app.rip',
      'server.rip',
      'main.rip',
      'index.ts',
    ]
    const hasValidEntryPoint = possibleEntryPoints.some(file =>
      existsSync(join(config.directory, file)),
    )

    if (!hasValidEntryPoint) {
      throw new Error(
        `No entry point found in ${config.directory}. Looking for: ${possibleEntryPoints.join(', ')}`,
      )
    }

    // Auto-assign port if not specified
    const port = config.port || this.findAvailablePort()

    // Create full app config with defaults
    const fullConfig: AppConfig = {
      name: appName,
      directory: config.directory,
      port,
      workers: config.workers || 3,
      mode: config.mode || 'dev',
      protocol: config.protocol || 'http',
      httpsPort: config.httpsPort,
      certPath: config.certPath,
      keyPath: config.keyPath,
      env: config.env || {},
    }

    // Reserve the port
    this.usedPorts.add(port)
    if (fullConfig.httpsPort) {
      this.usedPorts.add(fullConfig.httpsPort)
    }

    // Create app instance
    const appInstance: AppInstance = {
      config: fullConfig,
      status: 'starting',
      startedAt: new Date(),
    }

    this.apps.set(appName, appInstance)

    try {
      // Start the app processes
      await this.startAppProcesses(appInstance)

      console.log(`🚀 App '${appName}' deployed successfully on port ${port}`)
      return appInstance
    } catch (error) {
      // Cleanup on failure
      this.apps.delete(appName)
      this.usedPorts.delete(port)
      if (fullConfig.httpsPort) {
        this.usedPorts.delete(fullConfig.httpsPort)
      }
      throw error
    }
  }

  /**
   * Undeploy an application
   */
  async undeployApp(appName: string): Promise<void> {
    const app = this.apps.get(appName)
    if (!app) {
      throw new Error(`App '${appName}' not found`)
    }

    console.log(`🛑 Undeploying app '${appName}'...`)

    app.status = 'stopping'

    try {
      // Stop processes gracefully
      if (app.manager) {
        app.manager.kill('SIGTERM')
        await app.manager.exited
      }

      if (app.server) {
        app.server.kill('SIGTERM')
        await app.server.exited
      }

      // Free up ports
      this.usedPorts.delete(app.config.port)
      if (app.config.httpsPort) {
        this.usedPorts.delete(app.config.httpsPort)
      }

      // Remove from apps map
      this.apps.delete(appName)

      console.log(`✅ App '${appName}' undeployed successfully`)
    } catch (error) {
      app.status = 'error'
      app.error = error.message
      throw error
    }
  }

  /**
   * Scale an application (change worker count)
   */
  async scaleApp(appName: string, workers: number): Promise<void> {
    const app = this.apps.get(appName)
    if (!app) {
      throw new Error(`App '${appName}' not found`)
    }

    if (workers < 1) {
      throw new Error('Worker count must be at least 1')
    }

    console.log(`📊 Scaling app '${appName}' to ${workers} workers...`)

    const oldWorkers = app.config.workers
    app.config.workers = workers

    try {
      // Restart the app with new worker count
      await this.restartApp(appName)

      console.log(
        `✅ App '${appName}' scaled from ${oldWorkers} to ${workers} workers`,
      )
    } catch (error) {
      // Revert on failure
      app.config.workers = oldWorkers
      throw error
    }
  }

  /**
   * Restart an application
   */
  async restartApp(appName: string): Promise<void> {
    const app = this.apps.get(appName)
    if (!app) {
      throw new Error(`App '${appName}' not found`)
    }

    console.log(`🔄 Restarting app '${appName}'...`)

    app.status = 'starting'

    // Stop existing processes
    if (app.manager) {
      app.manager.kill('SIGTERM')
      await app.manager.exited
    }

    if (app.server) {
      app.server.kill('SIGTERM')
      await app.server.exited
    }

    // Start fresh processes
    await this.startAppProcesses(app)

    console.log(`✅ App '${appName}' restarted successfully`)
  }

  /**
   * List all deployed applications
   */
  listApps(): AppInstance[] {
    return Array.from(this.apps.values())
  }

  /**
   * Get platform statistics
   */
  getStats(): PlatformStats {
    const apps = Array.from(this.apps.values())
    const runningApps = apps.filter(app => app.status === 'running')
    const totalWorkers = apps.reduce((sum, app) => sum + app.config.workers, 0)
    const uptime = Date.now() - this.startTime.getTime()

    return {
      totalApps: apps.length,
      runningApps: runningApps.length,
      totalWorkers,
      uptime,
      memoryUsage: process.memoryUsage(),
    }
  }

  /**
   * Get specific app status
   */
  getApp(appName: string): AppInstance | undefined {
    return this.apps.get(appName)
  }

  /**
   * Find an available port
   */
  private findAvailablePort(startPort = 3001): number {
    let port = startPort
    while (this.usedPorts.has(port)) {
      port++
    }
    return port
  }

  /**
   * Start the processes for an app (manager + server)
   */
  private async startAppProcesses(app: AppInstance): Promise<void> {
    const { config } = app
    const scriptDir = join(import.meta.dir)

    try {
      // Start manager process
      const managerArgs = [
        'bun',
        join(scriptDir, 'manager.ts'),
        '0', // manager ID
        config.directory, // app directory
        config.workers.toString(),
        '10', // requests per worker (default)
        config.mode,
      ]

      app.manager = spawn(managerArgs, {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, ...config.env },
      })

      // Wait a bit for manager to start
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Start server process
      const serverArgs = [
        'bun',
        join(scriptDir, 'server.ts'),
        '0', // server ID
        config.port.toString(),
        config.workers.toString(),
      ]

      // Add HTTPS args if needed
      if (config.protocol === 'https' || config.protocol === 'http+https') {
        if (config.httpsPort) serverArgs.push(config.httpsPort.toString())
        if (config.certPath) serverArgs.push(config.certPath)
        if (config.keyPath) serverArgs.push(config.keyPath)
      }

      app.server = spawn(serverArgs, {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, ...config.env },
      })

      // Monitor processes
      this.monitorAppProcesses(app)

      // Wait a bit for server to start, then mark as running
      await new Promise(resolve => setTimeout(resolve, 1000))
      app.status = 'running'
      app.pid = app.server.pid
    } catch (error) {
      app.status = 'error'
      app.error = error.message
      throw error
    }
  }

  /**
   * Monitor app processes and handle failures
   */
  private monitorAppProcesses(app: AppInstance): void {
    const { config } = app

    // Monitor manager
    if (app.manager) {
      app.manager.exited.then(code => {
        if (app.status !== 'stopping') {
          console.error(
            `❌ Manager for app '${config.name}' exited with code ${code}`,
          )
          app.status = 'error'
          app.error = `Manager process exited with code ${code}`
        }
      })
    }

    // Monitor server
    if (app.server) {
      app.server.exited.then(code => {
        if (app.status !== 'stopping') {
          console.error(
            `❌ Server for app '${config.name}' exited with code ${code}`,
          )
          app.status = 'error'
          app.error = `Server process exited with code ${code}`
        }
      })
    }
  }

  /**
   * Start the platform management server
   */
  private async startPlatformServer(): Promise<void> {
    const server = Bun.serve({
      port: this.platformPort,
      fetch: async req => {
        const url = new URL(req.url)

        // API endpoints
        if (url.pathname.startsWith('/api')) {
          return this.handleAPIRequest(req)
        }

        // Dashboard
        if (url.pathname.startsWith('/platform')) {
          return this.handleDashboardRequest(req)
        }

        // Default response
        return new Response(
          '🚀 Rip Platform Controller\n\nVisit /platform for dashboard\nVisit /api for API docs',
          {
            headers: { 'Content-Type': 'text/plain' },
          },
        )
      },
    })

    console.log(`🌐 Platform server started on port ${this.platformPort}`)
  }

  /**
   * Handle API requests
   */
  private async handleAPIRequest(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname.replace('/api', '')

    try {
      switch (req.method) {
        case 'GET':
          if (path === '/apps') {
            return Response.json(this.listApps())
          }
          if (path === '/stats') {
            return Response.json(this.getStats())
          }
          if (path.startsWith('/apps/')) {
            const appName = path.split('/')[2]
            const app = this.getApp(appName)
            if (!app) {
              return Response.json({ error: 'App not found' }, { status: 404 })
            }
            return Response.json(app)
          }
          break

        case 'POST':
          if (path === '/apps') {
            const body = (await req.json()) as Partial<AppConfig> & {
              name: string
              directory: string
            }
            const app = await this.deployApp(body)
            return Response.json(app, { status: 201 })
          }
          break

        case 'DELETE':
          if (path.startsWith('/apps/')) {
            const appName = path.split('/')[2]
            await this.undeployApp(appName)
            return Response.json({ message: 'App undeployed successfully' })
          }
          break

        case 'PUT':
          if (path.startsWith('/apps/') && path.endsWith('/scale')) {
            const appName = path.split('/')[2]
            const { workers } = (await req.json()) as { workers: number }
            await this.scaleApp(appName, workers)
            return Response.json({ message: 'App scaled successfully' })
          }
          if (path.startsWith('/apps/') && path.endsWith('/restart')) {
            const appName = path.split('/')[2]
            await this.restartApp(appName)
            return Response.json({ message: 'App restarted successfully' })
          }
          break
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 })
    }
  }

  /**
   * Handle dashboard requests
   */
  private async handleDashboardRequest(req: Request): Promise<Response> {
    const apps = this.listApps()
    const stats = this.getStats()

    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>🚀 Rip Platform Dashboard</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; }
        .header { border-bottom: 2px solid #eee; padding-bottom: 20px; margin-bottom: 30px; }
        .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 30px; }
        .stat { background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center; }
        .stat-value { font-size: 24px; font-weight: bold; color: #2563eb; }
        .apps { display: grid; gap: 20px; }
        .app { border: 1px solid #ddd; border-radius: 8px; padding: 20px; background: white; }
        .app.running { border-left: 4px solid #10b981; }
        .app.error { border-left: 4px solid #ef4444; }
        .app.starting { border-left: 4px solid #f59e0b; }
        .app-header { display: flex; justify-content: between; align-items: center; margin-bottom: 10px; }
        .app-name { font-size: 18px; font-weight: bold; }
        .app-status { padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; }
        .status-running { background: #dcfce7; color: #166534; }
        .status-error { background: #fee2e2; color: #991b1b; }
        .status-starting { background: #fef3c7; color: #92400e; }
        .app-details { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin: 15px 0; }
        .detail { text-align: center; }
        .detail-label { font-size: 12px; color: #6b7280; }
        .detail-value { font-weight: bold; }
        .actions { display: flex; gap: 10px; }
        .btn { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; }
        .btn-danger { background: #ef4444; color: white; }
        .btn-warning { background: #f59e0b; color: white; }
        .btn-primary { background: #2563eb; color: white; }
        .no-apps { text-align: center; padding: 40px; color: #6b7280; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🚀 Rip Platform Dashboard</h1>
        <p>Dynamic Application Management Platform</p>
    </div>

    <div class="stats">
        <div class="stat">
            <div class="stat-value">${stats.totalApps}</div>
            <div>Total Apps</div>
        </div>
        <div class="stat">
            <div class="stat-value">${stats.runningApps}</div>
            <div>Running Apps</div>
        </div>
        <div class="stat">
            <div class="stat-value">${stats.totalWorkers}</div>
            <div>Total Workers</div>
        </div>
        <div class="stat">
            <div class="stat-value">${Math.round(stats.uptime / 1000 / 60)}m</div>
            <div>Platform Uptime</div>
        </div>
    </div>

    <div class="apps">
        ${
          apps.length === 0
            ? `
            <div class="no-apps">
                <h3>No apps deployed yet</h3>
                <p>Use the CLI to deploy your first app:</p>
                <code>rip-server deploy apps/my-app --port 3001</code>
            </div>
        `
            : apps
                .map(
                  app => `
            <div class="app ${app.status}">
                <div class="app-header">
                    <div class="app-name">📱 ${app.config.name}</div>
                    <div class="app-status status-${app.status}">${app.status.toUpperCase()}</div>
                </div>

                <div class="app-details">
                    <div class="detail">
                        <div class="detail-label">Port</div>
                        <div class="detail-value">:${app.config.port}</div>
                    </div>
                    <div class="detail">
                        <div class="detail-label">Workers</div>
                        <div class="detail-value">${app.config.workers}</div>
                    </div>
                    <div class="detail">
                        <div class="detail-label">Mode</div>
                        <div class="detail-value">${app.config.mode}</div>
                    </div>
                </div>

                <div style="margin: 15px 0; font-size: 14px; color: #6b7280;">
                    📁 ${app.config.directory} • Started ${new Date(app.startedAt).toLocaleTimeString()}
                    ${app.error ? `<br>❌ Error: ${app.error}` : ''}
                </div>

                <div class="actions">
                    ${
                      app.status === 'running'
                        ? `
                        <button class="btn btn-primary" onclick="restartApp('${app.config.name}')">🔄 Restart</button>
                        <button class="btn btn-warning" onclick="scaleApp('${app.config.name}')">📊 Scale</button>
                    `
                        : ''
                    }
                    <button class="btn btn-danger" onclick="undeployApp('${app.config.name}')">🗑️ Undeploy</button>
                </div>
            </div>
        `,
                )
                .join('')
        }
    </div>

    <script>
        async function restartApp(name) {
            if (!confirm(\`Restart app '\${name}'?\`)) return;
            try {
                const response = await fetch(\`/api/apps/\${name}/restart\`, { method: 'PUT' });
                if (response.ok) {
                    location.reload();
                } else {
                    alert('Failed to restart app');
                }
            } catch (error) {
                alert('Error: ' + error.message);
            }
        }

        async function undeployApp(name) {
            if (!confirm(\`Undeploy app '\${name}'? This will stop the app and remove it from the platform.\`)) return;
            try {
                const response = await fetch(\`/api/apps/\${name}\`, { method: 'DELETE' });
                if (response.ok) {
                    location.reload();
                } else {
                    alert('Failed to undeploy app');
                }
            } catch (error) {
                alert('Error: ' + error.message);
            }
        }

        async function scaleApp(name) {
            const workers = prompt('Number of workers:');
            if (!workers || isNaN(workers)) return;
            try {
                const response = await fetch(\`/api/apps/\${name}/scale\`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ workers: parseInt(workers) })
                });
                if (response.ok) {
                    location.reload();
                } else {
                    alert('Failed to scale app');
                }
            } catch (error) {
                alert('Error: ' + error.message);
            }
        }

        // Auto-refresh every 5 seconds
        setTimeout(() => location.reload(), 5000);
    </script>
</body>
</html>`

    return new Response(html, {
      headers: { 'Content-Type': 'text/html' },
    })
  }
}
