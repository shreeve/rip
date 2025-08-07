#!/usr/bin/env bun

/**
 * 🚀 Rip Server - Pure TypeScript Implementation
 * No more shell scripts, no more spawn issues!
 *
 * Flexible argument parsing - provide arguments in ANY order!
 */

import { existsSync, mkdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { spawn } from 'bun'
import { RipPlatform, type AppConfig } from './platform-controller'

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
  json?: boolean
}

function parseArgs(args: string[]): Config {
  const config: Config = {}
  const commands = [
    'dev',
    'prod',
    'start',
    'stop',
    'status',
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
    // Platform commands
    'platform',
    'deploy',
    'undeploy',
    'list',
    'scale',
    'restart',
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
    // JSON output flag
    if (arg === '--json' || arg === '-j') {
      config.json = true
      continue
    }
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
    if (existsSync(resolved) && statSync(resolved).isDirectory()) {
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

// Helper to check if rip-server is running
async function isRunning(): Promise<boolean> {
  try {
    const proc = spawn(['pgrep', '-f', 'rip-server'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const code = await proc.exited
    return code === 0
  } catch {
    return false
  }
}

// Comprehensive status check
async function showStatus(asJson = false): Promise<boolean> {
  if (!asJson) console.log('🔍 Rip Server Status\n')

  try {
    // Check if any rip-server processes are running
    const proc = spawn(['pgrep', '-fl', 'rip-server'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const output = await new Response(proc.stdout).text()
    const code = await proc.exited

    if (code === 0 && output.trim()) {
      const processes: Array<{
        pid: number
        ppid?: number
        runtime?: string
        memoryMB?: number
        command: string
        port?: number
        health?: 'HEALTHY' | 'UNHEALTHY' | 'NO_RESPONSE'
      }> = []

      if (!asJson) console.log('✅ Status: Running\n')

      const lines = output.trim().split('\n')
      console.log('📋 Active Processes:')

      if (!asJson) console.log('📋 Active Processes:')
      for (const line of lines) {
        const [pid, ...cmdParts] = line.split(' ')
        const cmd = cmdParts.join(' ')

        // Get process details
        try {
          const psProc = spawn(['ps', '-p', pid, '-o', 'pid,ppid,etime,rss,args'], {
            stdout: 'pipe',
            stderr: 'pipe',
          })
          const psOutput = await new Response(psProc.stdout).text()
          const psLines = psOutput.trim().split('\n')

          if (psLines.length > 1) {
            const [header, processLine] = psLines
            const parts = processLine.trim().split(/\s+/)
            const [procPid, ppid, etime, rss, ...args] = parts
            const command = args.join(' ')

            const memoryMB = Math.round(parseInt(rss) / 1024)
            const procInfo: any = {
              pid: Number(procPid),
              ppid: Number(ppid),
              runtime: etime,
              memoryMB,
              command,
            }

            // Extract port information from command line
            const portMatch = command.match(/(\d{4,5})/)
            if (portMatch) {
              const port = Number(portMatch[1])
              procInfo.port = port

              // Test if port is actually listening
              try {
                const response = await fetch(`http://localhost:${port}/health`, {
                  signal: AbortSignal.timeout(2000)
                })
                procInfo.health = response.ok ? 'HEALTHY' : 'UNHEALTHY'
              } catch {
                procInfo.health = 'NO_RESPONSE'
              }
            }

            processes.push(procInfo)

            if (!asJson) {
              console.log(`   • PID: ${procPid} | Parent: ${ppid} | Runtime: ${etime} | Memory: ${memoryMB}MB`)
              if (procInfo.port) {
                const healthText = procInfo.health === 'HEALTHY' ? '🟢 HEALTHY' : procInfo.health === 'UNHEALTHY' ? '🟡 UNHEALTHY' : '🔴 NO RESPONSE'
                console.log(`     Port: ${procInfo.port} | ${healthText}`)
              } else {
                console.log(`     Command: ${command.length > 80 ? command.substring(0, 80) + '...' : command}`)
              }
            }
          }
        } catch {
          if (!asJson) console.log(`   • PID: ${pid} | Command: ${cmd}`)
          processes.push({ pid: Number(pid), command: cmd })
        }
        if (!asJson) console.log('')
      }

      // Check for common ports
      const portStatuses: Array<{ port: number; protocol: 'http' | 'https'; status: 'ACTIVE' | 'INACTIVE'; httpStatus?: number }> = []
      if (!asJson) console.log('🌐 Port Status:')
      const commonPorts = [3000, 3001, 3002, 3443, 8080, 8443]

      for (const port of commonPorts) {
        try {
          const response = await fetch(`http://localhost:${port}/health`, {
            signal: AbortSignal.timeout(1000)
          })
          if (!asJson) console.log(`   • Port ${port}: 🟢 ACTIVE (HTTP ${response.status})`)
          portStatuses.push({ port, protocol: 'http', status: 'ACTIVE', httpStatus: response.status })
        } catch {
          try {
            const response = await fetch(`https://localhost:${port}/health`, {
              signal: AbortSignal.timeout(1000)
            })
            if (!asJson) console.log(`   • Port ${port}: 🟢 ACTIVE (HTTPS ${response.status})`)
            portStatuses.push({ port, protocol: 'https', status: 'ACTIVE', httpStatus: response.status })
          } catch {
            // Port not responding - don't show anything for inactive ports
            portStatuses.push({ port, protocol: 'http', status: 'INACTIVE' })
          }
        }
      }

      if (asJson) {
        const result = { running: true, processes, ports: portStatuses }
        console.log(JSON.stringify(result, null, 2))
      }
      return true

    } else {
      if (asJson) {
        console.log(JSON.stringify({ running: false }))
      } else {
        console.log('❌ Status: Not Running')
        console.log('\n💡 To start: bun server [options]')
      }
      return false
    }

  } catch (error) {
    if (asJson) {
      console.log(JSON.stringify({ running: false, error: String(error) }))
    } else {
      console.log('❌ Status: ERROR checking processes')
      console.error('Error:', error)
    }
    return false
  }
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

  // Check for any valid entry point (POLS: be permissive, let worker handle discovery)
  const possibleEntryPoints = ['index.rip', 'app.rip', 'server.rip', 'main.rip', 'index.ts']
  const hasValidEntryPoint = possibleEntryPoints.some(file => existsSync(join(appDir, file)))

  if (!hasValidEntryPoint) {
    console.error(`❌ No entry point found in: ${appDir}`)
    console.error(`   Looking for: ${possibleEntryPoints.join(', ')}`)

    // Check if we're in a monorepo root and suggest better usage
    const isMonorepoRoot = existsSync(join(appDir, 'packages')) ||
                          existsSync(join(appDir, 'examples')) ||
                          existsSync(join(appDir, 'apps'))

    if (isMonorepoRoot) {
      console.error(``)
      console.error(`💡 Looks like you're in a monorepo root. Try:`)
      console.error(`   bun server apps/your-app     # From monorepo root`)
      console.error(`   cd apps/your-app && rip-server  # Navigate to app first`)
    }

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

// Platform command implementations
let platformInstance: RipPlatform | null = null

async function startPlatform(config: Config): Promise<void> {
  const port = config.httpPort || 3000

  console.log('🌐 Starting Rip Platform Controller...')
  platformInstance = new RipPlatform(port)
  await platformInstance.start()

  // Keep the platform running
  await new Promise(() => {})
}

async function deployApp(config: Config, args: string[]): Promise<void> {
  const platformUrl = 'http://localhost:3000'

  // Parse deploy arguments: rip-server deploy <name> <directory> [--port <port>] [--workers <workers>]
  if (args.length < 2) {
    console.error('❌ Usage: rip-server deploy <name> <directory> [--port <port>] [--workers <workers>]')
    process.exit(1)
  }

  const [name, directory] = args
  const deployConfig: any = {
    name,
    directory: resolve(directory),
    port: 3001,
    workers: 2,
    mode: 'dev',
    protocol: 'http'
  }

  // Parse additional options
  for (let i = 2; i < args.length; i += 2) {
    const flag = args[i]
    const value = args[i + 1]

    switch (flag) {
      case '--port':
        deployConfig.port = parseInt(value)
        break
      case '--workers':
        deployConfig.workers = parseInt(value)
        break
      case '--mode':
        deployConfig.mode = value
        break
      case '--protocol':
        deployConfig.protocol = value
        break
    }
  }

  try {
    console.log(`🚀 Deploying app '${name}' from ${directory}...`)

    const response = await fetch(`${platformUrl}/api/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deployConfig)
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`HTTP ${response.status}: ${error}`)
    }

    const result = await response.json()
    console.log(`✅ App '${name}' deployed successfully`)
    console.log(`🌐 Available at: http://localhost:${deployConfig.port}`)
  } catch (error: any) {
    if (error.cause?.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
      console.error('❌ Platform not running. Start with: rip-server platform')
    } else {
      console.error(`❌ Failed to deploy app '${name}': ${error.message}`)
    }
    process.exit(1)
  }
}

async function undeployApp(args: string[]): Promise<void> {
  const platformUrl = 'http://localhost:3000'

  if (args.length < 1) {
    console.error('❌ Usage: rip-server undeploy <name>')
    process.exit(1)
  }

  const [name] = args

  try {
    console.log(`🛑 Undeploying app '${name}'...`)

    const response = await fetch(`${platformUrl}/api/undeploy/${name}`, {
      method: 'DELETE'
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`HTTP ${response.status}: ${error}`)
    }

    console.log(`✅ App '${name}' undeployed successfully`)
  } catch (error: any) {
    if (error.cause?.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
      console.error('❌ Platform not running. Start with: rip-server platform')
    } else {
      console.error(`❌ Failed to undeploy app '${name}': ${error.message}`)
    }
    process.exit(1)
  }
}

async function listPlatformApps(): Promise<void> {
  const platformUrl = 'http://localhost:3000'

  try {
    console.log('📋 Fetching platform status...')

    const response = await fetch(`${platformUrl}/api/stats`)

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`HTTP ${response.status}: ${error}`)
    }

    const data = await response.json()

    console.log('🚀 Rip Platform Status')
    console.log(`📊 Total Apps: ${data.totalApps || 0} | Running: ${data.runningApps || 0} | Workers: ${data.totalWorkers || 0}`)
    console.log(`⏱️  Platform Uptime: ${Math.round((data.uptime || 0) / 1000 / 60)} minutes`)
    console.log('')

    if (!data.apps || data.apps.length === 0) {
      console.log('📱 No apps deployed')
      console.log('💡 Deploy an app with: rip-server deploy <name> <directory>')
      return
    }

    console.log('📱 Deployed Apps:')
    data.apps.forEach((app: any) => {
      const statusEmoji = {
        'running': '🟢',
        'starting': '🟡',
        'stopping': '🟠',
        'stopped': '⚫',
        'error': '🔴'
      }[app.status] || '⚪'

      const runtime = app.startedAt ? Math.round((Date.now() - new Date(app.startedAt).getTime()) / 1000 / 60) : 0

      console.log(`   ${statusEmoji} ${app.name.padEnd(15)} :${app.port.toString().padEnd(5)} ${app.workers}w ${app.mode.padEnd(4)} ${runtime}m`)

      if (app.error) {
        console.log(`      ❌ ${app.error}`)
      }
    })

    console.log('')
    console.log('🌐 Platform Dashboard: http://localhost:3000/platform')
  } catch (error: any) {
    if (error.cause?.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
      console.error('❌ Platform not running. Start with: rip-server platform')
    } else {
      console.error(`❌ Failed to get platform status: ${error.message}`)
    }
    process.exit(1)
  }
}

async function scalePlatformApp(args: string[]): Promise<void> {
  const platformUrl = 'http://localhost:3000'

  if (args.length < 2) {
    console.error('❌ Usage: rip-server scale <name> <workers>')
    process.exit(1)
  }

  const [name, workersStr] = args
  const workers = parseInt(workersStr)

  if (isNaN(workers) || workers < 1) {
    console.error('❌ Workers must be a positive number')
    process.exit(1)
  }

  try {
    console.log(`⚡ Scaling app '${name}' to ${workers} workers...`)

    const response = await fetch(`${platformUrl}/api/scale/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workers })
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`HTTP ${response.status}: ${error}`)
    }

    console.log(`✅ App '${name}' scaled to ${workers} workers`)
  } catch (error: any) {
    if (error.cause?.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
      console.error('❌ Platform not running. Start with: rip-server platform')
    } else {
      console.error(`❌ Failed to scale app '${name}': ${error.message}`)
    }
    process.exit(1)
  }
}

async function restartPlatformApp(args: string[]): Promise<void> {
  const platformUrl = 'http://localhost:3000'

  if (args.length < 1) {
    console.error('❌ Usage: rip-server restart <name>')
    process.exit(1)
  }

  const [name] = args

  try {
    console.log(`🔄 Restarting app '${name}'...`)

    const response = await fetch(`${platformUrl}/api/restart/${name}`, {
      method: 'POST'
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`HTTP ${response.status}: ${error}`)
    }

    console.log(`✅ App '${name}' restarted successfully`)
  } catch (error: any) {
    if (error.cause?.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
      console.error('❌ Platform not running. Start with: rip-server platform')
    } else {
      console.error(`❌ Failed to restart app '${name}': ${error.message}`)
    }
    process.exit(1)
  }
}

// Main
async function main() {
  const args = process.argv.slice(2)
  const config = parseArgs(args)

  // Determine command - default to 'start' for everything except explicit commands
  const command = config.command || 'start'

  switch (command) {
    case 'start': {
      const running = await isRunning()
      if (running) {
        console.log('🔄 rip-server is already running, restarting...')
        await killAll()
        // Small delay to ensure clean shutdown
        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      console.log('🚀 Starting rip-server...')
      // Load file config and start
      const fileConfig = await loadFileConfig(config.appDir || defaults.appDir)
      const finalConfig = {
        ...defaults,
        ...fileConfig,
        ...config,
      }
      await start(finalConfig)
      process.exit(0)
    }

    case 'stop': {
      const running = await isRunning()
      if (running) {
        console.log('🛑 Stopping rip-server...')
        await killAll()
        process.exit(0)
      } else {
        console.log('✅ rip-server is already stopped')
        process.exit(0)
      }
    }

    case 'status': {
      const ok = await showStatus(!!config.json)
      process.exit(ok ? 0 : 3)
    }

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

    // Platform commands
    case 'platform': {
      await startPlatform(config)
      break
    }

    case 'deploy': {
      await deployApp(config, args)
      break
    }

    case 'undeploy': {
      await undeployApp(args)
      break
    }

    case 'list': {
      await listPlatformApps()
      break
    }

    case 'scale': {
      await scalePlatformApp(args)
      break
    }

    case 'restart': {
      await restartPlatformApp(args)
      break
    }

    case 'help':
    case '-h':
    case '--help':
      console.log(`🚀 Rip Application Server

Usage:
  bun server [options...]      # Recommended (from monorepo root)
  rip-server [options...]      # Direct usage

Smart Behavior:
  bun server apps/my-app        Start/restart server (recommended)
  bun server status             Show detailed server status
  bun server stop               Stop server (if running)

  rip-server [options]          Start/restart with options (direct)
  rip-server status             Show detailed server status
  rip-server stop               Stop server (if running)

Commands:
  dev       Development mode
  prod      Production mode
  status    Show server status and health
  test      Run test suite
  help      Show this help

Platform Commands (Dynamic Multi-App Management):
  platform  Start the Rip Platform Controller
  deploy    Deploy an app to the platform
  undeploy  Remove an app from the platform
  list      List all deployed apps
  scale     Scale an app's worker count
  restart   Restart a deployed app

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

Single App Examples:
  bun server apps/my-app            # Start/restart app (recommended)
  bun server apps/api https         # Start/restart with HTTPS
  bun server apps/blog 8080         # Start/restart on custom port
  bun server status                 # Show server status
  bun server stop                   # Stop server

  rip-server                        # Start/restart HTTP server (direct)
  rip-server https                  # Start/restart with HTTPS
  rip-server https:quick            # Start/restart with self-signed cert
  rip-server ./api prod             # Start/restart production mode

Platform Examples (Multi-App Management):
  # Terminal 1: Start platform
  rip-server platform               # Start the platform controller

  # Terminal 2: Deploy and manage apps
  rip-server deploy blog examples/blog --port 3001 --workers 3
  rip-server deploy api apps/labs/api --port 3002 --workers 5
  rip-server list                   # Show all deployed apps
  rip-server scale api 10           # Scale API to 10 workers
  rip-server restart blog           # Restart blog app
  rip-server undeploy api           # Remove API app
  rip-server w:5 r:50               # Start/restart with 5 workers, 50 requests
  rip-server stop                   # Stop server

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
      process.exit(0)
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
      process.exit(0)
    }
  }
}

// Run
main().catch(console.error)
