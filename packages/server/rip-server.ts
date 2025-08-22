/**
 * Rip Server CLI: parse flags, start Server + Manager.
 */

import { parseFlags } from './utils'
import { Manager } from './manager'
import { Server } from './server'

async function main(): Promise<void> {
  if (process.argv.includes('--stop')) {
    try {
      // Best-effort: find and kill matching processes by script path
      const script = __filename
      await Bun.spawn(['pkill', '-f', script]).exited
    } catch {}
    console.log('rip-server: stop requested')
    return
  }
  const flags = parseFlags(process.argv)
  const lb = new Server(flags)
  lb.start()
  const mgr = new Manager(flags)
  await mgr.start()
  const port = flags.httpPort ?? 0
  const url = `http://localhost:${port}/server`
  console.log(`rip-server: app=${flags.appName} http=${port} workers=${flags.workers} url=${url}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
