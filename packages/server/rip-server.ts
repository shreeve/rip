/**
 * Rip Server CLI: parse flags, start Server + Manager.
 */

import { parseFlags } from './utils'
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
  const flags = parseFlags(process.argv)
  const svr = new Server(flags)
  await svr.start()
  const mgr = new Manager(flags)
  await mgr.start()
  const http = flags.httpPort ?? 0
  const https = flags.httpsPort ?? 0
  const url = https ? `https://localhost:${https}/server` : `http://localhost:${http}/server`
  console.log(`rip-server: app=${flags.appName} workers=${flags.workers} url=${url}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
