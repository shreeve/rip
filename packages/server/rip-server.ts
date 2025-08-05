#!/usr/bin/env bun

/**
 * 🚀 Rip Server - Pure TypeScript Implementation
 * No more shell scripts, no more spawn issues!
 *
 * Flexible argument parsing - provide arguments in ANY order!
 */

import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { spawn } from 'bun'

// Set process title for better visibility in ps/top
process.title = 'rip-server'

const SCRIPT_DIR = import.meta.dir
const RIP_CONFIG_DIR = join(homedir(), '.rip-server')
const CA_DIR = join(RIP_CONFIG_DIR, 'ca')
const CERTS_DIR = join(RIP_CONFIG_DIR, 'certs')

// Configuration defaults
const defaults = {
  mode: 'dev',
  httpPort: 3000,
  httpsPort: 3443,
  workers: 3,
  requests: 10,
  appDir: process.cwd(),
  protocol: 'http' as 'http' | 'https' | 'http+https',
  httpsMode: 'smart' as 'smart' | 'quick' | 'ca',
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
  protocol?: 'http' | 'https' | 'http+https'
  httpsMode?: 'smart' | 'quick' | 'ca'
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
    'ca:init',
    'ca:trust',
    'ca:export',
    'ca:info',
    'ca:list',
    'ca:clean',
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
      config.workers = Number.parseInt(arg.substring(2))
      continue
    }

    // Request count: r:100
    if (arg.match(/^r:\d+$/)) {
      config.requests = Number.parseInt(arg.substring(2))
      continue
    }

    // Port number (1-65535)
    const port = Number.parseInt(arg)
    if (!Number.isNaN(port) && port >= 1 && port <= 65535) {
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

    // Protocol specifiers
    if (arg === 'http' || arg === 'https' || arg === 'http+https') {
      config.protocol = arg
      continue
    }

    // HTTPS mode specifiers
    if (arg === 'https:quick' || arg === 'https:ca' || arg === 'https:smart') {
      config.protocol = 'https'
      config.httpsMode = arg.split(':')[1] as 'quick' | 'ca' | 'smart'
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

        if (workers) config.workers = Number.parseInt(workers[1])
        if (requests) config.requests = Number.parseInt(requests[1])
        if (httpPort) config.httpPort = Number.parseInt(httpPort[1])
        if (httpsPort) config.httpsPort = Number.parseInt(httpsPort[1])
      }
    } catch {}
  }

  return config
}

// Helper to kill all rip processes
async function killAll() {
  console.log('🛑 Stopping all rip-server processes...')

  // Kill the main rip-server process
  const proc1 = spawn(['pkill', '-f', 'rip-server'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  await proc1.exited

  // Also kill any lingering server components
  const proc2 = spawn(['pkill', '-f', 'server/(manager|worker|server).ts'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  await proc2.exited

  // Clean up Unix socket files
  const proc3 = spawn(['rm', '-f', '/tmp/rip_worker_*.sock'], {
    stdout: 'pipe',
    stderr: 'pipe',
    shell: true, // Need shell to expand the wildcard
  })
  await proc3.exited

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

// Ensure directories exist
function ensureDirectories() {
  if (!existsSync(RIP_CONFIG_DIR)) {
    mkdirSync(RIP_CONFIG_DIR, { recursive: true })
  }
  if (!existsSync(CA_DIR)) {
    mkdirSync(CA_DIR, { recursive: true })
  }
  if (!existsSync(CERTS_DIR)) {
    mkdirSync(CERTS_DIR, { recursive: true })
  }
}

// Check if CA exists
function hasCA(): boolean {
  return (
    existsSync(join(CA_DIR, 'root.crt')) && existsSync(join(CA_DIR, 'root.key'))
  )
}

// Initialize CA
async function initCA(): Promise<void> {
  ensureDirectories()

  console.log('🔐 Initializing Certificate Authority...')

  const rootKey = join(CA_DIR, 'root.key')
  const rootCrt = join(CA_DIR, 'root.crt')

  // Generate Root CA key
  const keyProc = spawn(['openssl', 'genrsa', '-out', rootKey, '3072'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  await keyProc.exited

  // Generate Root CA certificate
  const certProc = spawn(
    [
      'openssl',
      'req',
      '-x509',
      '-nodes',
      '-sha256',
      '-new',
      '-key',
      rootKey,
      '-out',
      rootCrt,
      '-days',
      '731',
      '-subj',
      '/CN=Rip Server Development CA',
      '-addext',
      'keyUsage = critical, keyCertSign',
      '-addext',
      'basicConstraints = critical, CA:TRUE, pathlen:0',
      '-addext',
      'subjectKeyIdentifier = hash',
    ],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )

  await certProc.exited

  console.log('✅ CA initialized at ~/.rip-server/ca/')
}

// Generate CA-signed certificate
async function generateCACert(
  domain = 'localhost',
): Promise<{ cert: string; key: string }> {
  ensureDirectories()

  if (!hasCA()) {
    await initCA()
  }

  const certKey = join(CERTS_DIR, `${domain}.key`)
  const certCsr = join(CERTS_DIR, `${domain}.csr`)
  const certCrt = join(CERTS_DIR, `${domain}.crt`)

  // Check if cert already exists
  if (existsSync(certCrt) && existsSync(certKey)) {
    return {
      cert: await Bun.file(certCrt).text(),
      key: await Bun.file(certKey).text(),
    }
  }

  console.log(`🔐 Generating certificate for ${domain}...`)

  // Get local IP
  const getLocalIP = async (): Promise<string> => {
    if (process.platform === 'darwin') {
      const proc = spawn(['ipconfig', 'getifaddr', 'en0'], { stdout: 'pipe' })
      const output = await new Response(proc.stdout).text()
      return output.trim() || '127.0.0.1'
    }
    return '127.0.0.1'
  }

  const localIP = await getLocalIP()

  // Generate site key
  const keyProc = spawn(['openssl', 'genrsa', '-out', certKey, '2048'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  await keyProc.exited

  // Generate CSR
  const csrProc = spawn(
    [
      'openssl',
      'req',
      '-sha256',
      '-new',
      '-key',
      certKey,
      '-out',
      certCsr,
      '-subj',
      `/CN=${domain}`,
    ],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )

  await csrProc.exited

  // Sign the certificate
  const signProc = spawn(
    [
      'openssl',
      'x509',
      '-req',
      '-sha256',
      '-in',
      certCsr,
      '-out',
      certCrt,
      '-days',
      '731',
      '-CAkey',
      join(CA_DIR, 'root.key'),
      '-CA',
      join(CA_DIR, 'root.crt'),
      '-CAcreateserial',
      '-extfile',
      '/dev/stdin',
    ],
    {
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: Bun.spawn(
        [
          'echo',
          `subjectAltName = DNS:${domain},DNS:*.${domain},DNS:localhost,IP:127.0.0.1,IP:${localIP}
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
basicConstraints = CA:FALSE
authorityKeyIdentifier = keyid:always
subjectKeyIdentifier = hash`,
        ],
        { stdout: 'pipe' },
      ).stdout,
    },
  )

  await signProc.exited

  // Clean up CSR
  await Bun.spawn(['rm', '-f', certCsr]).exited

  return {
    cert: await Bun.file(certCrt).text(),
    key: await Bun.file(certKey).text(),
  }
}

// Trust CA on system
async function trustCA(): Promise<void> {
  if (!hasCA()) {
    console.error('❌ No CA found. Run "rip-server ca:init" first.')
    return
  }

  const rootCrt = join(CA_DIR, 'root.crt')

  if (process.platform === 'darwin') {
    console.log('🔐 Adding CA to macOS keychain...')
    const proc = spawn(
      [
        'sudo',
        'security',
        'add-trusted-cert',
        '-d',
        '-r',
        'trustRoot',
        '-k',
        '/Library/Keychains/System.keychain',
        rootCrt,
      ],
      {
        stdout: 'inherit',
        stderr: 'inherit',
        stdin: 'inherit',
      },
    )

    const code = await proc.exited
    if (code === 0) {
      console.log('✅ CA trusted in system keychain')
    } else {
      console.error('❌ Failed to trust CA')
    }
  } else {
    console.log('ℹ️  Manual trust required for your OS')
    console.log(`   CA certificate: ${rootCrt}`)
  }
}

// Export CA certificate
async function exportCA(): Promise<void> {
  if (!hasCA()) {
    console.error('❌ No CA found. Run "rip-server ca:init" first.')
    return
  }

  const rootCrt = join(CA_DIR, 'root.crt')
  const exportPath = join(process.cwd(), 'rip-server-ca.crt')

  await Bun.write(exportPath, Bun.file(rootCrt))
  console.log(`✅ CA certificate exported to: ${exportPath}`)
  console.log('   Import this certificate to your browser as a trusted root CA')
}

// Show CA info
async function showCAInfo(): Promise<void> {
  if (!hasCA()) {
    console.log('❌ No CA found. Run "rip-server ca:init" to create one.')
    return
  }

  const rootCrt = join(CA_DIR, 'root.crt')

  console.log('🔐 Certificate Authority Information:')
  console.log(`   Location: ${CA_DIR}`)
  console.log(`   Certificate: ${rootCrt}`)

  const proc = spawn(
    ['openssl', 'x509', '-in', rootCrt, '-noout', '-subject', '-dates'],
    {
      stdout: 'inherit',
      stderr: 'inherit',
    },
  )

  await proc.exited
}

// List generated certificates
async function listCerts(): Promise<void> {
  ensureDirectories()

  console.log('📜 Generated Certificates:')
  console.log(`   Directory: ${CERTS_DIR}`)

  const proc = spawn(['ls', '-la', CERTS_DIR], {
    stdout: 'inherit',
    stderr: 'inherit',
  })

  await proc.exited
}

// Clean old certificates
async function cleanCerts(): Promise<void> {
  console.log('🧹 Cleaning certificates...')

  const proc = spawn(['rm', '-rf', CERTS_DIR], {
    stdout: 'inherit',
    stderr: 'inherit',
  })

  await proc.exited

  mkdirSync(CERTS_DIR, { recursive: true })
  console.log('✅ Certificates cleaned')
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
    protocol = defaults.protocol,
    httpsMode = defaults.httpsMode,
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
  const endpoints: string[] = []
  let httpsEnabled = false
  let actualCertPath = certPath
  let actualKeyPath = keyPath

  // Determine protocols to use
  const useHTTP = protocol === 'http' || protocol === 'http+https'
  const useHTTPS = protocol === 'https' || protocol === 'http+https'

  if (useHTTP) {
    endpoints.push(`   📡 HTTP:    http://localhost:${httpPort}`)
  }

  // Handle HTTPS configuration
  if (useHTTPS) {
    httpsEnabled = true

    // Smart certificate selection
    if (certPath && keyPath) {
      // User provided certificates
      console.log('🔒 Using provided certificates')
    } else {
      // Need to generate/find certificates
      switch (httpsMode) {
        case 'quick': {
          console.log('🔐 Generating quick self-signed certificate...')
          console.log('⚠️  Self-signed certificates are for development only!')
          console.log('   Browsers will show security warnings.')
          const quickCert = await generateSelfSignedCert()
          await Bun.write('/tmp/rip-cert.pem', quickCert.cert)
          await Bun.write('/tmp/rip-key.pem', quickCert.key)
          actualCertPath = '/tmp/rip-cert.pem'
          actualKeyPath = '/tmp/rip-key.pem'
          break
        }

        case 'ca': {
          console.log('🔐 Using CA-signed certificate...')
          const caCert = await generateCACert('localhost')
          await Bun.write('/tmp/rip-cert.pem', caCert.cert)
          await Bun.write('/tmp/rip-key.pem', caCert.key)
          actualCertPath = '/tmp/rip-cert.pem'
          actualKeyPath = '/tmp/rip-key.pem'
          if (!hasCA()) {
            console.log(
              '💡 Run "rip-server ca:trust" to trust the CA in your system',
            )
          }
          break
        }
        default:
          // Smart mode: prefer CA if available, otherwise quick
          if (hasCA()) {
            console.log('🔐 Using existing CA-signed certificate...')
            const smartCert = await generateCACert('localhost')
            await Bun.write('/tmp/rip-cert.pem', smartCert.cert)
            await Bun.write('/tmp/rip-key.pem', smartCert.key)
            actualCertPath = '/tmp/rip-cert.pem'
            actualKeyPath = '/tmp/rip-key.pem'
          } else {
            console.log('🔐 No CA found. Initializing secure development CA...')
            await initCA()
            const smartCert = await generateCACert('localhost')
            await Bun.write('/tmp/rip-cert.pem', smartCert.cert)
            await Bun.write('/tmp/rip-key.pem', smartCert.key)
            actualCertPath = '/tmp/rip-cert.pem'
            actualKeyPath = '/tmp/rip-key.pem'
            console.log(
              '💡 Run "rip-server ca:trust" to trust the CA in your system',
            )
          }
          break
      }
    }

    endpoints.push(`   🔒 HTTPS:   https://localhost:${httpsPort}`)
  }

  if (endpoints.length === 0) {
    console.error('❌ No protocols enabled. Use http, https, or http+https')
    process.exit(1)
  }

  console.log(`
🌐 Endpoints:
${endpoints.join('\n')}
   🏥 Health:  ${useHTTP ? `http://localhost:${httpPort}` : `https://localhost:${httpsPort}`}/health
   📈 Metrics: ${useHTTP ? `http://localhost:${httpPort}` : `https://localhost:${httpsPort}`}/metrics

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
  const serverArgs = ['bun', join(SCRIPT_DIR, 'server.ts'), '0']

  // Configure ports based on protocol
  if (useHTTP && useHTTPS) {
    // Both protocols
    serverArgs.push(httpPort.toString(), workers.toString())
    serverArgs.push(httpsPort.toString(), actualCertPath, actualKeyPath)
  } else if (useHTTPS) {
    // HTTPS only - use HTTPS port as primary
    serverArgs.push(httpsPort.toString(), workers.toString())
    serverArgs.push(httpsPort.toString(), actualCertPath, actualKeyPath)
  } else {
    // HTTP only
    serverArgs.push(httpPort.toString(), workers.toString())
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

    case 'ca:init':
      await initCA()
      break

    case 'ca:trust':
      await trustCA()
      break

    case 'ca:export':
      await exportCA()
      break

    case 'ca:info':
      await showCAInfo()
      break

    case 'ca:list':
      await listCerts()
      break

    case 'ca:clean':
      await cleanCerts()
      break

    case 'help':
    case '-h':
    case '--help':
      console.log(`🚀 Rip Application Server

Usage:
  rip-server [command] [options...]

Commands:
  dev       Development mode (default)
  prod      Production mode
  stop      Stop all processes
  test      Run test suite
  help      Show this help

Certificate Authority Commands:
  ca:init   Initialize Certificate Authority
  ca:trust  Trust CA in system (macOS)
  ca:export Export CA certificate
  ca:info   Show CA information
  ca:list   List generated certificates
  ca:clean  Clean old certificates

Options (in ANY order!):
  ./path              App directory (default: current)
  3000                Port number (default: 3000 HTTP, 3443 HTTPS)
  cert.pem key.pem    Certificate files
  w:5                 Worker count (default: 3)
  r:100               Requests per worker (default: 10)

Protocol Options:
  http                HTTP only
  https               HTTPS with smart cert selection
  https:quick         HTTPS with quick self-signed cert
  https:ca            HTTPS with CA-signed cert
  http+https          Both HTTP and HTTPS

Examples:
  rip-server                        # HTTP only, current dir
  rip-server https                  # HTTPS with smart certs
  rip-server https:quick            # HTTPS with self-signed
  rip-server https:ca               # HTTPS with CA cert
  rip-server http+https             # Both protocols
  rip-server 8080                   # Custom HTTP port
  rip-server https 8443             # Custom HTTPS port
  rip-server ./api prod             # Production mode for ./api
  rip-server w:5 r:50               # 5 workers, 50 requests each
  rip-server cert.pem key.pem       # HTTPS with custom cert
  rip-server prod https w:10        # Prod HTTPS, 10 workers

Certificate Authority:
  rip-server ca:init                # One-time CA setup
  rip-server ca:trust               # Trust CA in system
  rip-server ca:export              # Export CA for browsers
  rip-server https                  # Use CA certs (after init)

Configuration files:
  package.json: { "rip-server": { "workers": 5, "requests": 100 } }
  bunfig.toml:  [rip-server]
                workers = 5
                requests = 100

🔥 Pure TypeScript, no shell scripts, no spawn issues!`)
      break

    case 'start':
    case 'dev':
    case 'prod': {
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
    }

    default: {
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
}

// Run
main().catch(console.error)
