import { dlopen, ptr, toArrayBuffer } from 'bun:ffi'
import { writeFileSync } from 'node:fs'

const [caddy, config, pidfile, exitfile] = process.argv.slice(2)

if (process.platform !== 'darwin') {
  throw new Error('the launchd edge listener is available only on macOS')
}
if (![caddy, config, pidfile, exitfile].every((value) => typeof value === 'string' && value.length)) {
  throw new Error('usage: launchd-listener.js <caddy> <config> <pidfile> <exitfile>')
}

const library = dlopen('/usr/lib/libSystem.B.dylib', {
  launch_activate_socket: {
    args: ['ptr', 'ptr', 'ptr'],
    returns: 'i32',
  },
  free: {
    args: ['ptr'],
    returns: 'void',
  },
  strerror: {
    args: ['i32'],
    returns: 'cstring',
  },
})

const finish = (result) => {
  writeFileSync(exitfile, `${JSON.stringify(result)}\n`, { mode: 0o600 })
}

const activate = (socketName) => {
  const name = Buffer.from(`${socketName}\0`)
  const descriptorsAddress = new BigUint64Array(1)
  const count = new BigUint64Array(1)
  const status = library.symbols.launch_activate_socket(ptr(name), ptr(descriptorsAddress), ptr(count))
  if (status !== 0) {
    throw new Error(`launch_activate_socket(${socketName}): ${library.symbols.strerror(status)}`)
  }
  if (count[0] !== 1n || descriptorsAddress[0] === 0n) {
    if (descriptorsAddress[0] !== 0n) library.symbols.free(Number(descriptorsAddress[0]))
    throw new Error(`launchd supplied ${count[0]} ${socketName} sockets; expected exactly one`)
  }
  const descriptors = new Int32Array(toArrayBuffer(Number(descriptorsAddress[0]), 0, 4))
  const listener = descriptors[0]
  library.symbols.free(Number(descriptorsAddress[0]))
  return listener
}

let child = null
let exitCode = 1

try {
  // stdio slots 0–2 are stdin/out/err; Caddy gets HTTP as fd/3 and HTTPS as fd/4.
  const httpListener = activate('HTTP')
  const httpsListener = activate('HTTPS')

  child = Bun.spawn(
    [caddy, 'run', '--config', config, '--adapter', 'caddyfile', '--pidfile', pidfile],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        RIP_EDGE_HTTP_BIND: 'fd/3',
        RIP_EDGE_BIND: 'fd/4',
      },
      stdio: ['ignore', 'inherit', 'inherit', httpListener, httpsListener],
    },
  )

  const forward = (signal) => {
    try {
      child.kill(signal)
    } catch {}
  }
  process.on('SIGINT', () => forward('SIGINT'))
  process.on('SIGTERM', () => forward('SIGTERM'))

  const code = await child.exited
  finish({ code, signal: child.signalCode ?? null })
  exitCode = code ?? 1
} catch (error) {
  finish({ code: 1, signal: null, error: error?.message ?? String(error) })
  console.error(`rip-edge: ${error?.message ?? error}`)
} finally {
  library.close()
}

process.exit(exitCode)
