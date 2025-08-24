/**
 * Rip Server CLI: parse flags, start Server + Manager.
 */

import { parseFlags, getControlSocketPath, resolveAppEntry } from './utils'
import { Manager } from './manager'
import { Server } from './server'

async function main(): Promise<void> {
  // Subcommand: `bun server stop` (position‑independent)
  if (process.argv.includes('stop')) {
    try {
      // Best-effort: find and kill matching processes by script path
      const script = __filename
      await Bun.spawn(['pkill', '-f', script]).exited
    } catch {}
    console.log('rip-server: stop requested')
    return
  }
  // Registry subcommands: list | add <host> | remove <host>
  {
    const argv = process.argv
    const idxAdd = argv.indexOf('add')
    const idxRemove = argv.indexOf('remove')
    const isList = argv.includes('list')
    if (isList || idxAdd >= 0 || idxRemove >= 0) {
      const getKV = (prefix: string): string | undefined => {
        for (const tok of argv) if (tok.startsWith(prefix)) return tok.slice(prefix.length)
        return undefined
      }
      const findAppPathToken = (): string | undefined => {
        for (let i = 2; i < argv.length; i++) {
          const tok = argv[i]
          const looksLikePath = tok.includes('/') || tok.startsWith('.') || tok.endsWith('.rip') || tok.endsWith('.ts')
          try {
            if (looksLikePath && require('fs').existsSync(require('path').isAbsolute(tok) ? tok : require('path').resolve(process.cwd(), tok))) return tok
          } catch {}
        }
        return undefined
      }
      const computeSocketPrefix = (): string => {
        const override = getKV('--socket-prefix=')
        if (override) return override
        const appTok = findAppPathToken()
        if (appTok) {
          try { const { appName } = resolveAppEntry(appTok); return `rip_${appName}` } catch {}
        }
        return 'rip_server'
      }
      const controlUnix = getControlSocketPath(computeSocketPrefix())
      const registryPath = 'http://localhost/registry'
      try {
        if (isList) {
          const res = await fetch(registryPath, { unix: controlUnix, method: 'GET' })
          if (!res.ok) throw new Error(`list failed: ${res.status}`)
          const j = await res.json()
          const hosts: string[] = Array.isArray(j?.hosts) ? j.hosts : []
          console.log(hosts.length ? hosts.join('\n') : '(no hosts)')
          return
        }
        if (idxAdd >= 0) {
          const host = argv[idxAdd + 1]
          if (!host) { console.error('Usage: bun server add <host> [--socket-prefix=...]'); process.exit(2) }
          const res = await fetch(registryPath, { unix: controlUnix, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ host }) })
          if (!res.ok) throw new Error(`add failed: ${res.status}`)
          console.log(`added: ${host}`)
          return
        }
        if (idxRemove >= 0) {
          const host = argv[idxRemove + 1]
          if (!host) { console.error('Usage: bun server remove <host> [--socket-prefix=...]'); process.exit(2) }
          const res = await fetch(registryPath, { unix: controlUnix, method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ host }) })
          if (!res.ok) throw new Error(`remove failed: ${res.status}`)
          console.log(`removed: ${host}`)
          return
        }
      } catch (e: any) {
        console.error(`registry command failed: ${e?.message || e}`)
        process.exit(1)
      }
    }
  }
  const flags = parseFlags(process.argv)
  const svr = new Server(flags)
  const mgr = new Manager(flags)

  // Cleanup handler for crashes and signals
  const cleanup = async () => {
    console.log('rip-server: shutting down...')
    svr.stop()
    await mgr.stop()
    process.exit(0)
  }

  // Handle various termination scenarios
  process.on('SIGTERM', cleanup)
  process.on('SIGINT', cleanup)
  process.on('uncaughtException', (err) => {
    console.error('rip-server: uncaught exception:', err)
    cleanup()
  })
  process.on('unhandledRejection', (err) => {
    console.error('rip-server: unhandled rejection:', err)
    cleanup()
  })

  await svr.start()
  await mgr.start()
  const httpOnly = flags.httpsPort === null
  const url = httpOnly
    ? `http://localhost:${flags.httpPort}/server`
    : `https://localhost:${flags.httpsPort}/server`
  console.log(`rip-server: app=${flags.appName} workers=${flags.workers} url=${url}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
