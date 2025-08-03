#!/usr/bin/env bun

/**
 * 🚀 Rip Server - Pure TypeScript Implementation
 * No more shell scripts, no more spawn issues!
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'bun'

const SCRIPT_DIR = import.meta.dir

// Parse command line arguments
const [, , command = 'dev', ...args] = process.argv

// Helper to kill all rip processes
async function killAll() {
  console.log('🛑 Stopping all rip-server processes...')
  const proc = spawn(['pkill', '-f', 'manager.ts|worker.ts|server.ts'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  await proc.exited
  console.log('✅ All processes stopped')
}

// Start command
async function start(
  _mode: string = 'dev',
  appDir: string = process.cwd(),
  httpsPort?: string,
  certPath?: string,
  keyPath?: string,
) {
  const appPath = resolve(appDir)

  // Verify app directory exists
  if (!existsSync(appPath)) {
    console.error(`❌ App directory not found: ${appPath}`)
    process.exit(1)
  }

  // Check for index.ts or index.rip
  const hasIndex =
    existsSync(join(appPath, 'index.ts')) ||
    existsSync(join(appPath, 'index.rip'))
  if (!hasIndex) {
    console.error(`❌ No index.ts or index.rip found in: ${appPath}`)
    process.exit(1)
  }

  const endpoints = [`   📡 HTTP:    http://localhost:3000`]
  if (httpsPort && certPath && keyPath) {
    endpoints.unshift(`   🔒 HTTPS:   https://localhost:${httpsPort}`)
  }

  console.log(`
🌐 Endpoints:
${endpoints.join('\n')}
   🏥 Health:  http://localhost:3000/health
   📈 Metrics: http://localhost:3000/metrics

🔥 Hot Reload: ${appPath}

🛑 Press Ctrl-C to stop
`)

  // Start manager
  const manager = spawn(
    ['bun', join(SCRIPT_DIR, 'manager.ts'), '0', '3', '10', appPath],
    {
      stdout: 'inherit',
      stderr: 'inherit',
      stdin: 'inherit',
    },
  )

  // Monitor manager
  manager.exited.then(code => {
    console.error(`Manager exited with code ${code}`)
    process.exit(1)
  })

  // Wait for workers to start
  await new Promise(resolve => setTimeout(resolve, 3000))

  // Start server
  const serverArgs = ['bun', join(SCRIPT_DIR, 'server.ts'), '0', '3000', '3']

  // Add HTTPS args if provided
  if (httpsPort && certPath && keyPath) {
    serverArgs.push(httpsPort, certPath, keyPath)
  }

  const server = spawn(serverArgs, {
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  })

  // Monitor server
  server.exited.then(code => {
    console.error(`Server exited with code ${code}`)
    process.exit(1)
  })

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...')
    manager.kill()
    server.kill()
    await killAll()
    process.exit(0)
  })

  // Keep running (always foreground)
  await new Promise(() => {})
}

// Main command handler
switch (command) {
  case 'start':
  case 'dev':
  case 'prod': {
    const mode = command === 'start' ? args[0] || 'dev' : command
    const baseIdx = command === 'start' ? 1 : 0
    const appDir = args[baseIdx] || process.cwd()
    const httpsPort = args[baseIdx + 1]
    const certPath = args[baseIdx + 2]
    const keyPath = args[baseIdx + 3]
    await start(mode, appDir, httpsPort, certPath, keyPath)
    break
  }

  case 'stop':
    await killAll()
    break

  case 'test': {
    console.log('🧪 Running tests...')
    const test = spawn(['bun', 'test', '--timeout', '20000'], {
      cwd: SCRIPT_DIR,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    const testCode = await test.exited
    process.exit(testCode)
    break
  }

  case 'help':
  case '-h':
  case '--help':
    console.log(`🚀 Rip Application Server

Usage:
  rip-server start [mode] [app_dir] [https_port] [cert_path] [key_path]
  rip-server dev   [app_dir] [https_port] [cert_path] [key_path]
  rip-server prod  [app_dir] [https_port] [cert_path] [key_path]
  rip-server stop
  rip-server test

Examples:
  rip-server                        # Start dev server (default)
  rip-server dev                    # Start development server
  rip-server dev ./api              # Dev server with specific app
  rip-server dev ./api 3443 cert.pem key.pem  # With HTTPS
  rip-server stop                   # Stop all processes
  rip-server test                   # Run test suite

🔥 Pure TypeScript, no shell scripts, no spawn issues!`)
    break

  default:
    // Default to dev mode
    await start('dev', args[0] || process.cwd(), args[1], args[2], args[3])
}
