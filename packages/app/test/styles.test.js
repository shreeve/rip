import { test, expect } from 'bun:test'
import { UNITLESS } from '../styles.rip'
import { UNITLESS as MINTED } from '../../../src/ts/dom-types.js'

// The package's CSSProperties and the alias the compiler mints for a native
// tag's `style` are one type spelled twice; the unitless list is the one part
// that is data, so it is held in lockstep here.
test('the unitless list matches the one the compiler mints', () => {
  expect([...UNITLESS]).toEqual(MINTED)
})
