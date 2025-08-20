/**
 * Rip CLI entry (server1 variant)
 */

import { parseFlags } from './utils'
import { Manager } from './manager'
import { LBServer } from './server'

async function main(): Promise<void> {
  const flags = parseFlags(process.argv)
  const manager = new Manager(flags)
  await manager.start()
  const lb = new LBServer(flags)
  lb.start()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

