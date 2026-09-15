import { test, expect } from 'bun:test'
import { UNITLESS, parseStyle, toStyle, mergeStyles, withMargin } from '../shared/styles.rip'
import { UNITLESS as MINTED } from '../../../src/ts/dom-types.js'

// The package's CSSProperties and the alias the compiler mints for a native
// tag's `style` are one type spelled twice; the unitless list is the one part
// that is data, so it is held in lockstep here.
test('the unitless list matches the one the compiler mints', () => {
  expect([...UNITLESS]).toEqual(MINTED)
})

test('parseStyle: camelCases property names, keeps custom properties, skips empties', () => {
  expect(parseStyle('font-size:14px; line-height : 1.4;;--brand:#06a;bad;color:rgb(1, 2, 3)')).toEqual({
    fontSize: '14px', lineHeight: '1.4', '--brand': '#06a', color: 'rgb(1, 2, 3)',
  })
})

test('toStyle: a string parses, an object passes through, absence is empty', () => {
  const object = { margin: 0 }
  expect(toStyle(object)).toBe(object)
  expect(toStyle('margin:0')).toEqual({ margin: '0' })
  expect(toStyle('')).toEqual({})
  expect(toStyle(null)).toEqual({})
  expect(toStyle(false)).toEqual({})
})

test('mergeStyles: later wins by key, a key keeps its first position, spellings mix', () => {
  const merged = mergeStyles({ fontSize: '14px', margin: '16px 0' }, 'margin:0;color:red', null, { color: 'blue' })
  expect(merged).toEqual({ fontSize: '14px', margin: '0', color: 'blue' })
  expect(Object.keys(merged)).toEqual(['fontSize', 'margin', 'color'])
})

test('withMargin: the shorthand props become margin keys, the specific side last', () => {
  expect(withMargin({ m: 0, mx: '8px', mt: '4px' })).toEqual({ margin: 0, marginLeft: '8px', marginRight: '8px', marginTop: '4px' })
  expect(withMargin()).toEqual({})
})
