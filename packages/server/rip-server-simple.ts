#!/usr/bin/env bun
/**
 * Rip Application Server - Ultra Simple Version
 * Just get it working first!
 */

import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

function showHelp(): void {
  console.log(`🚀 Rip Application Server - Simple Version

Usage:
  bun server help               # Show this help
  bun server status             # Show server status  
  bun server stop               # Stop server
  bun server [app-path]         # Start server with app

Examples:
  bun server apps/labs/api      # Start labs API
  bun server help               # Show help`);
}

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
      
    default:
      // Treat anything else as an app path
      const appPath = command.startsWith('./') || command.startsWith('/') || command.includes('/') 
        ? command 
        : process.cwd();
      await startServer(appPath);
      break;
  }
}

if (import.meta.main) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}
