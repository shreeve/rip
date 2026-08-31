import { type FullConfig } from '@playwright/test'
import { reseed } from './util'

export default function setup(config: FullConfig) {
  reseed(config.rootDir)
  return () => reseed(config.rootDir)
}
