import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { RipPlatform, type AppConfig } from './platform-controller';

async function isRunning(): Promise<boolean> {
  try {
    const response = await fetch('http://localhost:3000/health', {
      signal: AbortSignal.timeout(1000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function showStatus(): Promise<void> {
  console.log('🔍 Rip Server Status');

  const running = await isRunning();

  if (running) {
    console.log('✅ Status: RUNNING');
    console.log('🌐 URL: http://localhost:3000');
  } else {
    console.log('❌ Status: NOT RUNNING');
  }
}

async function stopServer(): Promise<void> {
  console.log('🛑 Stopping Rip Server...');

  try {
    await fetch('http://localhost:3000/shutdown', {
      method: 'POST',
      signal: AbortSignal.timeout(2000)
    });
    console.log('✅ Server stopped');
  } catch {
    console.log('⚠️  Server was not running');
  }
}

async function startServer(appPath: string): Promise<void> {
  console.log('🚀 Starting Rip Server...');
  console.log(`📁 App: ${appPath}`);

  // Resolve to absolute path from current working directory
  const absoluteAppPath = resolve(appPath);
  const indexPath = join(absoluteAppPath, 'index.rip');

  if (!existsSync(indexPath)) {
    console.error(`❌ No index.rip found in ${appPath}`);
    process.exit(1);
  }

  let ripApp: any;

  try {
    console.log(`📁 Loading: ${indexPath}`);
    ripApp = await import(indexPath);
    ripApp = ripApp.default || ripApp;
    console.log('✅ Rip app loaded');
  } catch (error) {
    console.error('❌ Failed to load Rip app:', error);
    process.exit(1);
  }

  // Create simple HTTP server
  const server = Bun.serve({
    port: 3000,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === '/health') {
        return new Response('{"status":"ok"}', {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.pathname === '/ping') {
        return new Response('pong');
      }

      if (url.pathname === '/shutdown' && req.method === 'POST') {
        setTimeout(() => process.exit(0), 100);
        return new Response('Shutting down...');
      }

      // Forward to Rip app
      try {
        if (typeof ripApp === 'function') {
          return await ripApp(req);
        } else if (ripApp && typeof ripApp.fetch === 'function') {
          return await ripApp.fetch(req);
        } else {
          return new Response('Invalid Rip app', { status: 500 });
        }
      } catch (error) {
        console.error('❌ Request error:', error);
        return new Response('Server Error', { status: 500 });
      }
    }
  });

  console.log('✅ Server running at http://localhost:3000');
  console.log('🎯 Press Ctrl+C to stop');
}

// Global platform instance
let platformInstance: RipPlatform | null = null;

async function startPlatform(): Promise<void> {
  console.log('🚀 Starting Rip Platform Controller...');

  platformInstance = new RipPlatform(3000);

  // Create platform server with API and dashboard
  const server = Bun.serve({
    port: 3000,
    async fetch(req) {
      const url = new URL(req.url);

      // Health check
      if (url.pathname === '/health') {
        return new Response('{"status":"ok","mode":"platform"}', {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Platform API
      if (url.pathname.startsWith('/api/')) {
        return handlePlatformAPI(req, url);
      }

      // Platform dashboard
      if (url.pathname === '/platform' || url.pathname === '/') {
        return new Response(getPlatformDashboard(), {
          headers: { 'Content-Type': 'text/html' }
        });
      }

      // Shutdown endpoint
      if (url.pathname === '/shutdown' && req.method === 'POST') {
        setTimeout(() => process.exit(0), 100);
        return new Response('Platform shutting down...');
      }

      // Forward to current app if any
      if (platformInstance?.getCurrentApp()) {
        const currentApp = platformInstance.getCurrentApp();
        try {
          // Load the current app and forward request
          const indexPath = join(currentApp!.directory, 'index.rip');
          let ripApp = await import(indexPath);
          ripApp = ripApp.default || ripApp;

          if (typeof ripApp === 'function') {
            return await ripApp(req);
          } else if (ripApp && typeof ripApp.fetch === 'function') {
            return await ripApp.fetch(req);
          }
        } catch (error) {
          console.error('❌ App request error:', error);
          return new Response('App Error', { status: 500 });
        }
      }

      return new Response('Platform Controller - No app running', { status: 404 });
    }
  });

  console.log('✅ Platform Controller running at http://localhost:3000');
  console.log('📊 Dashboard: http://localhost:3000/platform');
  console.log('🔧 API: http://localhost:3000/api');
  console.log('🎯 Press Ctrl+C to stop');
}

async function handlePlatformAPI(req: Request, url: URL): Promise<Response> {
  if (!platformInstance) {
    return new Response('{"error":"Platform not initialized"}', {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // GET /api/apps - List apps
    if (url.pathname === '/api/apps' && req.method === 'GET') {
      const apps = platformInstance.listApps();
      return new Response(JSON.stringify(apps, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // GET /api/stats - Platform stats
    if (url.pathname === '/api/stats' && req.method === 'GET') {
      const stats = platformInstance.getStats();
      return new Response(JSON.stringify(stats, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // POST /api/apps - Deploy app
    if (url.pathname === '/api/apps' && req.method === 'POST') {
      const body = await req.json() as { name: string; directory: string };
      const app = await platformInstance.deployApp(body.name, body.directory);
      return new Response(JSON.stringify(app, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // DELETE /api/apps/:name - Undeploy app
    const undeployMatch = url.pathname.match(/^\/api\/apps\/([^\/]+)$/);
    if (undeployMatch && req.method === 'DELETE') {
      const name = undeployMatch[1];
      await platformInstance.undeployApp(name);
      return new Response('{"status":"undeployed"}', {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // POST /api/apps/:name/start - Start app
    const startMatch = url.pathname.match(/^\/api\/apps\/([^\/]+)\/start$/);
    if (startMatch && req.method === 'POST') {
      const name = startMatch[1];
      await platformInstance.startApp(name);
      return new Response('{"status":"started"}', {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // POST /api/apps/:name/scale - Scale app
    const scaleMatch = url.pathname.match(/^\/api\/apps\/([^\/]+)\/scale$/);
    if (scaleMatch && req.method === 'POST') {
      const name = scaleMatch[1];
      const body = await req.json() as { workers: number };
      
      const app = platformInstance.getApp(name);
      if (!app) {
        return new Response('{"error":"App not found"}', {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const previousWorkers = app.workers;
      await platformInstance.scaleApp(name, body.workers);
      
      return new Response(JSON.stringify({
        status: 'scaled',
        previousWorkers,
        currentWorkers: body.workers
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // POST /api/apps/:name/restart - Restart app
    const restartMatch = url.pathname.match(/^\/api\/apps\/([^\/]+)\/restart$/);
    if (restartMatch && req.method === 'POST') {
      const name = restartMatch[1];
      
      const app = platformInstance.getApp(name);
      if (!app) {
        return new Response('{"error":"App not found"}', {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Restart by stopping and starting
      if (app.status === 'running') {
        await platformInstance.stopApp(name);
        await platformInstance.startApp(name);
      } else {
        await platformInstance.startApp(name);
      }
      
      return new Response('{"status":"restarted"}', {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('{"error":"API endpoint not found"}', {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ Platform API error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

function getPlatformDashboard(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>🚀 Rip Platform Controller</title>
  <style>
    body { font-family: system-ui; margin: 40px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { background: white; padding: 30px; border-radius: 10px; margin-bottom: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .apps { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .app { padding: 15px; border: 1px solid #ddd; border-radius: 5px; margin: 10px 0; }
    .running { border-color: #4CAF50; background: #f8fff8; }
    .stopped { border-color: #ccc; background: #f8f8f8; }
    button { padding: 8px 16px; margin: 5px; border: none; border-radius: 4px; cursor: pointer; }
    .deploy { background: #4CAF50; color: white; }
    .start { background: #2196F3; color: white; }
    .stop { background: #f44336; color: white; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 Rip Platform Controller</h1>
      <p><strong>Revolutionary Dynamic Application Platform</strong></p>
      <p>Deploy, manage, and scale Rip applications on the fly!</p>
      <p>🌐 <strong>Platform API:</strong> <a href="/api/apps">/api/apps</a> | <strong>Stats:</strong> <a href="/api/stats">/api/stats</a></p>
    </div>

    <div class="apps">
      <h2>📱 Deployed Applications</h2>
      <div id="apps-list">Loading apps...</div>

      <h3>➕ Deploy New App</h3>
      <div>
        <input type="text" id="app-name" placeholder="App name (e.g., labs-api)" style="padding: 8px; margin: 5px;">
        <input type="text" id="app-path" placeholder="App path (e.g., apps/labs/api)" style="padding: 8px; margin: 5px;">
        <button class="deploy" onclick="deployApp()">Deploy App</button>
      </div>
    </div>
  </div>

  <script>
    async function loadApps() {
      try {
        const response = await fetch('/api/apps');
        const apps = await response.json();
        const container = document.getElementById('apps-list');

        if (apps.length === 0) {
          container.innerHTML = '<p>No apps deployed yet. Deploy your first app above!</p>';
          return;
        }

        container.innerHTML = apps.map(app => \`
          <div class="app \${app.status}">
            <h4>\${app.name}</h4>
            <p><strong>Directory:</strong> \${app.directory}</p>
            <p><strong>Port:</strong> \${app.port} | <strong>Status:</strong> \${app.status}</p>
            \${app.startedAt ? \`<p><strong>Started:</strong> \${new Date(app.startedAt).toLocaleString()}</p>\` : ''}
            <button class="start" onclick="startApp('\${app.name}')">Start</button>
            <button class="stop" onclick="undeployApp('\${app.name}')">Undeploy</button>
          </div>
        \`).join('');
      } catch (error) {
        document.getElementById('apps-list').innerHTML = '<p>Error loading apps: ' + error.message + '</p>';
      }
    }

    async function deployApp() {
      const name = document.getElementById('app-name').value;
      const path = document.getElementById('app-path').value;

      if (!name || !path) {
        alert('Please provide both app name and path');
        return;
      }

      try {
        const response = await fetch('/api/apps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, directory: path })
        });

        if (response.ok) {
          document.getElementById('app-name').value = '';
          document.getElementById('app-path').value = '';
          loadApps();
          alert('App deployed successfully!');
        } else {
          const error = await response.json();
          alert('Deploy failed: ' + error.error);
        }
      } catch (error) {
        alert('Deploy failed: ' + error.message);
      }
    }

    async function startApp(name) {
      try {
        const response = await fetch(\`/api/apps/\${name}/start\`, { method: 'POST' });
        if (response.ok) {
          loadApps();
          alert('App started successfully!');
        } else {
          const error = await response.json();
          alert('Start failed: ' + error.error);
        }
      } catch (error) {
        alert('Start failed: ' + error.message);
      }
    }

    async function undeployApp(name) {
      if (!confirm(\`Are you sure you want to undeploy \${name}?\`)) return;

      try {
        const response = await fetch(\`/api/apps/\${name}\`, { method: 'DELETE' });
        if (response.ok) {
          loadApps();
          alert('App undeployed successfully!');
        } else {
          const error = await response.json();
          alert('Undeploy failed: ' + error.error);
        }
      } catch (error) {
        alert('Undeploy failed: ' + error.message);
      }
    }

    // Load apps on page load and refresh every 5 seconds
    loadApps();
    setInterval(loadApps, 5000);
  </script>
</body>
</html>`;
}

function showHelp(): void {
  console.log(`🚀 Rip Application Server

Usage:
  bun server help               # Show this help
  bun server status             # Show server status
  bun server stop               # Stop server
  bun server [app-path]         # Start server with app

Platform Mode (Dynamic Multi-App Management):
  bun server platform           # Start platform controller
  bun server deploy <name> <path>   # Deploy app to platform
  bun server undeploy <name>    # Remove app from platform
  bun server list               # List deployed apps
  bun server start <name>       # Start a deployed app
  bun server apps               # Show running apps

Examples:
  bun server apps/labs/api      # Start labs API directly
  bun server platform          # Start platform controller
  bun server deploy labs-api apps/labs/api  # Deploy to platform
  bun server start labs-api    # Start deployed app`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  switch (command) {
    case 'help':
      showHelp();
      break;

    case 'status':
      await showStatus();
      break;

    case 'stop':
      await stopServer();
      break;

    // Platform commands
    case 'platform':
      await startPlatform();
      break;

    case 'deploy':
      await handleDeploy(args[1], args[2]);
      break;

    case 'undeploy':
      await handleUndeploy(args[1]);
      break;

    case 'list':
    case 'apps':
      await handleListApps();
      break;

    case 'start':
      await handleStartApp(args[1]);
      break;

    case 'scale':
      await handleScale(args[1], args[2]);
      break;

    case 'restart':
      await handleRestartApp(args[1]);
      break;

    default:
      // Treat anything else as an app path
      const appPath = command.startsWith('./') || command.startsWith('/') || command.includes('/')
        ? command
        : process.cwd();
      await startServer(appPath);
      break;
  }
}

// Platform command handlers
async function handleDeploy(name?: string, directory?: string): Promise<void> {
  if (!name || !directory) {
    console.error('❌ Usage: bun server deploy <name> <directory>');
    console.error('   Example: bun server deploy labs-api apps/labs/api');
    process.exit(1);
  }

  try {
    const response = await fetch('http://localhost:3000/api/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, directory })
    });

    if (response.ok) {
      const app = await response.json();
      console.log(`✅ App '${name}' deployed successfully`);
      console.log(`📁 Directory: ${app.directory}`);
      console.log(`🌐 Port: ${app.port}`);
    } else {
      const error = await response.json();
      console.error(`❌ Deploy failed: ${error.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Platform not running. Start it with: bun server platform');
    process.exit(1);
  }
}

async function handleUndeploy(name?: string): Promise<void> {
  if (!name) {
    console.error('❌ Usage: bun server undeploy <name>');
    console.error('   Example: bun server undeploy labs-api');
    process.exit(1);
  }

  try {
    const response = await fetch(`http://localhost:3000/api/apps/${name}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      console.log(`✅ App '${name}' undeployed successfully`);
    } else {
      const error = await response.json();
      console.error(`❌ Undeploy failed: ${error.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Platform not running. Start it with: bun server platform');
    process.exit(1);
  }
}

async function handleListApps(): Promise<void> {
  try {
    const response = await fetch('http://localhost:3000/api/apps');

    if (response.ok) {
      const apps = await response.json();

      console.log('📱 Deployed Applications:');
      console.log('');

      if (apps.length === 0) {
        console.log('   No apps deployed yet');
        console.log('   Deploy your first app: bun server deploy <name> <path>');
        return;
      }

      apps.forEach((app: AppConfig) => {
        console.log(`   🚀 ${app.name}`);
        console.log(`      📁 Directory: ${app.directory}`);
        console.log(`      🌐 Port: ${app.port}`);
        console.log(`      📊 Status: ${app.status}`);
        if (app.startedAt) {
          console.log(`      ⏰ Started: ${new Date(app.startedAt).toLocaleString()}`);
        }
        console.log('');
      });
    } else {
      console.error('❌ Failed to fetch apps');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Platform not running. Start it with: bun server platform');
    process.exit(1);
  }
}

async function handleStartApp(name?: string): Promise<void> {
  if (!name) {
    console.error('❌ Usage: bun server start <name>');
    console.error('   Example: bun server start labs-api');
    process.exit(1);
  }

  try {
    const response = await fetch(`http://localhost:3000/api/apps/${name}/start`, {
      method: 'POST'
    });

    if (response.ok) {
      console.log(`✅ App '${name}' started successfully`);
      console.log('🌐 Available at: http://localhost:3000');
    } else {
      const error = await response.json();
      console.error(`❌ Start failed: ${error.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Platform not running. Start it with: bun server platform');
    process.exit(1);
  }
}

async function handleScale(name?: string, workersStr?: string): Promise<void> {
  if (!name || !workersStr) {
    console.error('❌ Usage: bun server scale <name> <workers>');
    console.error('   Example: bun server scale labs-api 5');
    process.exit(1);
  }

  const workers = parseInt(workersStr);
  if (isNaN(workers) || workers < 1 || workers > 20) {
    console.error('❌ Worker count must be a number between 1 and 20');
    process.exit(1);
  }

  try {
    const response = await fetch(`http://localhost:3000/api/apps/${name}/scale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workers }),
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`🚀 App '${name}' scaled to ${workers} workers`);
      console.log(`📊 Previous: ${result.previousWorkers} → Current: ${result.currentWorkers} workers`);
    } else {
      const error = await response.json();
      console.error(`❌ Scale failed: ${error.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Platform not running. Start it with: bun server platform');
    process.exit(1);
  }
}

async function handleRestartApp(name?: string): Promise<void> {
  if (!name) {
    console.error('❌ Usage: bun server restart <name>');
    console.error('   Example: bun server restart labs-api');
    process.exit(1);
  }

  try {
    const response = await fetch(`http://localhost:3000/api/apps/${name}/restart`, {
      method: 'POST',
    });

    if (response.ok) {
      console.log(`🔄 App '${name}' restarted successfully`);
    } else {
      const error = await response.json();
      console.error(`❌ Restart failed: ${error.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Platform not running. Start it with: bun server platform');
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}
