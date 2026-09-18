// A module-private component has living instances the dirty module must
// account for, and no export names its replacement. The compiler's
// component table is where the renderer finds it; without the table the
// instance is one no patch can carry, and the route takes the floor.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createComponents, createRenderer, createStash } from 'rip/app'
import { __Component, __hmrEvents } from '../../../src/runtime/components.js'
import { installRecordingDOM } from '../../../test/support/recording-dom.js'

const globals = ['document', 'requestAnimationFrame', 'Node', 'SVGElement']
const saved = Object.fromEntries(globals.map(name => [name, globalThis[name]]))
beforeAll(() => { installRecordingDOM() })
afterAll(() => {
  for (const name of globals) {
    if (saved[name] === undefined) delete globalThis[name]
    else globalThis[name] = saved[name]
  }
})

const sig = () => ({ shape: 'x', impl: 'y', state: [], computed: [], props: [], gates: 0, extends: null })
const componentClass = (id) => class extends __Component {
  static __hmrId = id
  static __hmrSig = sig()
  _create() { return document.createElement('section') }
}

// A route module exporting only its page, with one living instance of
// its private child, then a candidate module shaped by `staged`.
const apply = async (staged) => {
  const Page = componentClass('priv/page.rip#Page')
  const Child = componentClass('priv/page.rip#Child')
  const components = createComponents()
  components.write('priv/page.rip', 'stub')
  components.setCompiled('priv/page.rip', { Page })
  const target = document.createElement('div')
  document.body.appendChild(target)
  const info = { route: { file: 'priv/page.rip' }, layouts: [], params: {}, query: {} }
  const router = { current: info, navigating: false }
  const renderer = createRenderer({ router, stash: createStash({}), components, target })
  await renderer.mount(info)
  const page = renderer.current
  const host = document.createElement('div')
  document.body.appendChild(host)
  const child = new Child({}).mount(host)
  expect(child._state).toBe('mounted')

  const PageNext = componentClass('priv/page.rip#Page')
  const ChildNext = componentClass('priv/page.rip#Child')
  components.setCompiled('priv/page.rip', staged({ PageNext, ChildNext }))
  const before = __hmrEvents().length
  const verdict = await renderer.remountDirty(['priv/page.rip'])
  const events = __hmrEvents().slice(before).map(event => event.type)
  const result = { verdict, events, pageKept: renderer.current === page, childCtor: child.constructor }
  child.unmount()
  renderer.stop()
  return { ...result, ChildNext }
}

describe('a module-private component with a living instance', () => {
  test('patches through the module component table', async () => {
    const { verdict, events, pageKept, childCtor, ChildNext } = await apply(({ PageNext, ChildNext }) => ({
      Page: PageNext,
      __hmrComponents: { Page: PageNext, Child: ChildNext },
    }))
    expect(verdict).toBe('narrow')
    expect(events).toEqual(['patch', 'patch'])
    expect(pageKept).toBe(true)
    expect(childCtor).toBe(ChildNext)
  })

  test('takes the floor when no table or export holds its replacement', async () => {
    const { verdict, events, pageKept } = await apply(({ PageNext }) => ({ Page: PageNext }))
    expect(verdict).toBe('narrow')
    expect(events).toEqual(['patch', 'remount'])
    expect(pageKept).toBe(false)
  })
})
