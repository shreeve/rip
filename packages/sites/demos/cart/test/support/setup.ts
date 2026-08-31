import { type FullConfig } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

export default function setup(config: FullConfig) {
  const reseed = () => {
    const db = new DatabaseSync(join(config.rootDir, 'api/cart.sqlite'))
    try {
      db.exec('PRAGMA busy_timeout = 5000')
      db.exec('DELETE FROM users; DELETE FROM products; DELETE FROM orders')
    } finally {
      db.close()
    }
    execFileSync('rip', ['api/seed.rip'], { cwd: config.rootDir })
  }

  reseed()
  return reseed
}
