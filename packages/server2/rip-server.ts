/**
 * Rip Server2 CLI: parse flags, start Manager + LB.
 */

import { parseFlags } from './utils'
import { Manager } from './manager'
import { LBServer } from './server'

async function main(): Promise<void> {
  if (process.argv.includes('--stop')) {
    try {
      // Best-effort: find and kill matching processes by script path
      const script = __filename
      await Bun.spawn(['pkill', '-f', script]).exited
    } catch {}
    console.log('rip-server2: stop requested')
    return
  }
  const flags = parseFlags(process.argv)
  const lb = new LBServer(flags)
  lb.start()
  const mgr = new Manager(flags)
  await mgr.start()
  console.log(`rip-server2: app=${flags.appName} http=${flags.httpPort ?? '-'} workers=${flags.workers}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
