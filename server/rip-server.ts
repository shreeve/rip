#!/usr/bin/env bun

/**
 * 🚀 Rip Server - Pure TypeScript Implementation
 * No more shell scripts, no more spawn issues!
 *
 * Flexible argument parsing - provide arguments in ANY order!
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'bun'

const SCRIPT_DIR = import.meta.dir

// Configuration defaults
const defaults = {
  mode: 'dev',
  httpPort: 3000,
  httpsPort: 3443,
  workers: 3,
  requests: 10,
  appDir: process.cwd(),
}

// Parse flexible arguments
interface Config {
  command?: string
  mode?: string
  appDir?: string
  httpPort?: number
  httpsPort?: number
  certPath?: string
  keyPath?: string
  workers?: number
  requests?: number
}

function parseArgs(args: string[]): Config {
  const config: Config = {}
  const commands = [
    'dev',
    'prod',
    'start',
    'stop',
    'test',
    'help',
    '-h',
    '--help',
  ]

  // First, check for command
  if (args.length > 0 && commands.includes(args[0])) {
    config.command = args[0]
    args = args.slice(1)
  }

  // Separate cert/key files from other args
  const certFiles: string[] = []
  const otherArgs: string[] = []

  for (const arg of args) {
    // Check for cert/key files
    if (
      arg.endsWith('.pem') ||
      arg.endsWith('.crt') ||
      arg.endsWith('.key') ||
      arg.endsWith('.cert')
    ) {
      if (existsSync(arg)) {
        certFiles.push(arg)
      }
    } else {
      otherArgs.push(arg)
    }
  }

  // Process cert files (need exactly 2)
  if (certFiles.length === 2) {
    // Try to identify which is cert and which is key
    const [file1, file2] = certFiles
    if (file1.includes('key') || file2.includes('cert')) {
      config.keyPath = file1
      config.certPath = file2
    } else if (file2.includes('key') || file1.includes('cert')) {
      config.certPath = file1
      config.keyPath = file2
    } else {
      // Default assumption: first is cert, second is key
      config.certPath = file1
      config.keyPath = file2
    }
  }

  // Process remaining arguments
  for (const arg of otherArgs) {
    // Worker count: w:5
    if (arg.match(/^w:\d+$/)) {
      config.workers = parseInt(arg.substring(2))
      continue
    }

    // Request count: r:100
    if (arg.match(/^r:\d+$/)) {
      config.requests = parseInt(arg.substring(2))
      continue
    }

    // Port number (1-65535)
    const port = parseInt(arg)
    if (!isNaN(port) && port >= 1 && port <= 65535) {
      // If HTTPS is configured, this is HTTPS port, otherwise HTTP
      if (config.certPath && config.keyPath) {
        config.httpsPort = port
      } else {
        config.httpPort = port
      }
      continue
    }

    // Directory path
    if (arg.startsWith('/') || arg.startsWith('./') || arg.startsWith('../')) {
      const resolved = resolve(arg)
      if (existsSync(resolved)) {
        config.appDir = resolved
        continue
      }
    }

    // Check if it's an existing directory
    const resolved = resolve(arg)
    if (existsSync(resolved) && Bun.file(resolved).size === undefined) {
      config.appDir = resolved
      continue
    }

    // Mode (dev/prod)
    if (arg === 'dev' || arg === 'prod') {
      config.mode = arg
      continue
    }
  }

  return config
}

// Load configuration from files
async function loadFileConfig(appDir: string): Promise<Partial<Config>> {
  const config: Partial<Config> = {}

  // Try package.json
  const packagePath = join(appDir, 'package.json')
  if (existsSync(packagePath)) {
    try {
      const pkg = await Bun.file(packagePath).json()
      if (pkg['rip-server']) {
        Object.assign(config, pkg['rip-server'])
      }
    } catch {}
  }

  // Try bunfig.toml
  const bunfigPath = join(appDir, 'bunfig.toml')
  if (existsSync(bunfigPath)) {
    try {
      const bunfig = await Bun.file(bunfigPath).text()
      // Simple extraction for rip-server section
      const match = bunfig.match(/\[rip-server\]([\s\S]*?)(?:\n\[|$)/)
      if (match) {
        const section = match[1]
        // Extract simple key = value pairs
        const workers = section.match(/workers\s*=\s*(\d+)/)
        const requests = section.match(/requests\s*=\s*(\d+)/)
        const httpPort = section.match(/httpPort\s*=\s*(\d+)/)
        const httpsPort = section.match(/httpsPort\s*=\s*(\d+)/)

        if (workers) config.workers = parseInt(workers[1])
        if (requests) config.requests = parseInt(requests[1])
        if (httpPort) config.httpPort = parseInt(httpPort[1])
        if (httpsPort) config.httpsPort = parseInt(httpsPort[1])
      }
    } catch {}
  }

  return config
}

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

// Generate self-signed certificate
async function generateSelfSignedCert(): Promise<{
  cert: string
  key: string
}> {
  console.log('🔐 Generating self-signed certificate...')

  // Use openssl to generate a self-signed cert
  const proc = spawn(
    [
      'openssl',
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      '/tmp/rip-key.pem',
      '-out',
      '/tmp/rip-cert.pem',
      '-days',
      '365',
      '-nodes',
      '-subj',
      '/CN=localhost',
    ],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )

  await proc.exited

  const cert = await Bun.file('/tmp/rip-cert.pem').text()
  const key = await Bun.file('/tmp/rip-key.pem').text()

  return { cert, key }
}

// Start command
async function start(config: Config) {
  const {
    mode = defaults.mode,
    appDir = defaults.appDir,
    httpPort = defaults.httpPort,
    httpsPort = defaults.httpsPort,
    workers = defaults.workers,
    requests = defaults.requests,
    certPath,
    keyPath,
  } = config

  // Verify app directory exists
  if (!existsSync(appDir)) {
    console.error(`❌ App directory not found: ${appDir}`)
    process.exit(1)
  }

  // Check for index.ts or index.rip
  const hasIndex =
    existsSync(join(appDir, 'index.ts')) ||
    existsSync(join(appDir, 'index.rip'))
  if (!hasIndex) {
    console.error(`❌ No index.ts or index.rip found in: ${appDir}`)
    process.exit(1)
  }

  // Build endpoints display
  const endpoints = [`   📡 HTTP:    http://localhost:${httpPort}`]
  let httpsEnabled = false
  let actualCertPath = certPath
  let actualKeyPath = keyPath

  // Check for HTTPS
  if (certPath && keyPath) {
    httpsEnabled = true
  } else if (httpsPort !== defaults.httpsPort || mode === 'prod') {
    // Auto-generate self-signed cert if HTTPS port specified or in prod mode
    console.log(
      '🔐 No certificate provided, generating self-signed certificate...',
    )
    console.log(
      '⚠️  Self-signed certificates are for development only!',
    )
    console.log(
      '   Browsers will show security warnings. For production, use real certificates.',
    )
    const { cert, key } = await generateSelfSignedCert()
    await Bun.write('/tmp/rip-cert.pem', cert)
    await Bun.write('/tmp/rip-key.pem', key)
    actualCertPath = '/tmp/rip-cert.pem'
    actualKeyPath = '/tmp/rip-key.pem'
    httpsEnabled = true
  }

  if (httpsEnabled) {
    endpoints.unshift(`   🔒 HTTPS:   https://localhost:${httpsPort}`)
  }

  console.log(`
🌐 Endpoints:
${endpoints.join('\n')}
   🏥 Health:  http://localhost:${httpPort}/health
   📈 Metrics: http://localhost:${httpPort}/metrics

⚙️  Configuration:
   📁 App:      ${appDir}
   🔧 Mode:     ${mode}
   👷 Workers:  ${workers}
   📊 Requests: ${requests} per worker

🔥 Hot Reload: ${appDir}

🛑 Press Ctrl-C to stop
`)

  // Start manager
  const manager = spawn(
    [
      'bun',
      join(SCRIPT_DIR, 'manager.ts'),
      '0',
      workers.toString(),
      requests.toString(),
      appDir,
    ],
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
  const serverArgs = [
    'bun',
    join(SCRIPT_DIR, 'server.ts'),
    '0',
    httpPort.toString(),
    workers.toString(),
  ]

  // Add HTTPS args if enabled
  if (httpsEnabled && actualCertPath && actualKeyPath) {
    serverArgs.push(httpsPort.toString(), actualCertPath, actualKeyPath)
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

// Main
async function main() {
  const args = process.argv.slice(2)
  const config = parseArgs(args)

  // Determine command
  const command = config.command || (args.length === 0 ? 'dev' : 'start')

  switch (command) {
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
  rip-server [command] [options...]

Commands:
  dev    Development mode (default)
  prod   Production mode
  stop   Stop all processes
  test   Run test suite
  help   Show this help

Options (in ANY order!):
  ./path           App directory (default: current)
  3000             Port number (default: 3000 HTTP, 3443 HTTPS)
  cert.pem key.pem Certificate files (auto-generates if omitted)
  w:5              Worker count (default: 3)
  r:100            Requests per worker (default: 10)

Examples:
  rip-server                        # Dev mode, current dir
  rip-server 8080                   # Dev mode on port 8080
  rip-server ./api prod             # Production mode for ./api
  rip-server w:5 r:50               # 5 workers, 50 requests each
  rip-server cert.pem key.pem 3443  # HTTPS with custom cert
  rip-server prod 8080 w:10         # Prod mode, port 8080, 10 workers

Configuration files:
  package.json: { "rip-server": { "workers": 5, "requests": 100 } }
  bunfig.toml:  [rip-server]
                workers = 5
                requests = 100

🔥 Pure TypeScript, no shell scripts, no spawn issues!`)
      break

    case 'start':
    case 'dev':
    case 'prod':
      // Load file config
      const fileConfig = await loadFileConfig(config.appDir || defaults.appDir)

      // Merge configs: defaults < file < command line
      const finalConfig = {
        ...defaults,
        ...fileConfig,
        ...config,
        mode: command === 'start' ? config.mode || 'dev' : command,
      }

      await start(finalConfig)
      break

    default:
      // Treat as start with arguments
      const startConfig = await loadFileConfig(config.appDir || defaults.appDir)
      const finalStartConfig = {
        ...defaults,
        ...startConfig,
        ...config,
      }
      await start(finalStartConfig)
  }
}

// Run
main().catch(console.error)
