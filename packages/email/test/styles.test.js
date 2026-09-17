import { test, expect } from 'bun:test'
import { parseStyle, toStyle, mergeStyles } from '../dom.rip'

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
