import { test, expect } from 'bun:test'
import { BasicEmail, lifecycle } from './fixtures/basic-email.rip'
import { toEmail } from '../email.rip'
import { renderOnce } from '../render.rip'

test('a render mounts, serializes, disposes, and restores the globals', () => {
  const hadDocument = Object.hasOwn(globalThis, 'document')
  const previousDocument = globalThis.document
  lifecycle.length = 0

  const out = toEmail(BasicEmail, { message: 'welcome' })
  expect(out.html).toContain('<!DOCTYPE')
  expect(out.html).toContain('<h1>Title</h1>')
  expect(out.html).toContain('<p>welcome</p>')
  expect(out.text).toBe('Title\n\nwelcome')
  expect(out.preview).toBeNull()
  expect(lifecycle).toEqual(['effect', 'cleanup'])

  expect(Object.hasOwn(globalThis, 'document')).toBe(hadDocument)
  expect(globalThis.document).toBe(previousDocument)
})

test('a render inside an active render is refused', () => {
  const hadDocument = Object.hasOwn(globalThis, 'document')
  const previousDocument = globalThis.document
  globalThis.document = { __ripRenderActive: true }
  try {
    expect(() => toEmail(BasicEmail)).toThrow(/nested or concurrent Rip email rendering/)
  } finally {
    if (hadDocument) globalThis.document = previousDocument
    else delete globalThis.document
  }
})

test('the exact global descriptors come back when teardown throws', () => {
  const keys = ['document', 'Node', 'SVGElement']
  const before = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))

  class BadCleanup {
    constructor() { this._state = 'new' }
    mount() { this._state = 'mounted' }
    unmount() { throw new Error('cleanup boom') }
  }

  expect(() => renderOnce(BadCleanup, {}, () => 'unused')).toThrow('cleanup boom')
  for (const key of keys) {
    expect(Object.getOwnPropertyDescriptor(globalThis, key)).toEqual(before.get(key))
  }
})

test('an accessor-backed global descriptor survives a render', () => {
  const keys = ['document', 'Node', 'SVGElement']
  const before = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const sentinel = {}
  Object.defineProperty(globalThis, 'Node', {
    configurable: true,
    enumerable: false,
    get: () => sentinel,
    set: () => { throw new Error('Node assignment blocked') },
  })
  const expected = Object.getOwnPropertyDescriptor(globalThis, 'Node')

  class Clean {
    constructor() { this._state = 'new' }
    mount() { this._state = 'mounted' }
    unmount() { this._state = 'unmounted' }
  }

  try {
    expect(renderOnce(Clean, {}, () => 'done')).toBe('done')
    expect(Object.getOwnPropertyDescriptor(globalThis, 'Node')).toEqual(expected)
    expect(Object.getOwnPropertyDescriptor(globalThis, 'document')).toEqual(before.get('document'))
    expect(Object.getOwnPropertyDescriptor(globalThis, 'SVGElement')).toEqual(before.get('SVGElement'))
  } finally {
    for (const key of keys) {
      const descriptor = before.get(key)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})

test('a partial global install rolls back to the prior globals', () => {
  const renderUrl = new URL('../render.rip', import.meta.url).href
  const source = `
    import { renderOnce } from ${JSON.stringify(renderUrl)};
    Object.defineProperty(globalThis, 'Node', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: 'sentinel',
    });
    try {
      renderOnce(class {}, {}, () => 'unused');
    } catch (error) {
      console.log(
        Object.hasOwn(globalThis, 'document'),
        globalThis.Node,
        error instanceof TypeError,
      );
    }
  `
  // The child is a bare `bun -e`, so the .rip import compiles only if a
  // bunfig preload is visible from its cwd: the repo root's is the one
  // loader config. FORCE_COLOR paints console.log booleans and breaks
  // the pin.
  const env = { ...process.env }
  delete env.FORCE_COLOR
  const result = Bun.spawnSync(['bun', '-e', source], {
    cwd: new URL('../../..', import.meta.url).pathname,
    env,
  })
  expect(result.exitCode).toBe(0)
  expect(result.stdout.toString().trim()).toBe('false sentinel true')
})
