import { describe, expect, test } from 'bun:test'
import { createApply, createComponents, createRenderer, createStash } from 'rip/app'
import { __Component } from '../../../src/runtime/components.js'

const target = () => ({
  children: [],
  appendChild(node) {
    this.children.push(node)
    return node
  },
})

const registry = entries => {
  const components = createComponents()
  for (const [file, module] of Object.entries(entries)) {
    components.write(file, 'stub')
    components.setCompiled(file, module)
  }
  return components
}

const live = async () => {
  class LivePage extends __Component { _create() { return null } }
  const info = { route: { file: 'page.rip' }, layouts: [], params: {}, query: {} }
  const components = registry({ 'page.rip': { LivePage } })
  const renderer = createRenderer({
    router: { current: info, navigating: false },
    stash: createStash({}),
    components,
    target: target(),
  })
  await renderer.mount(info)
  const apply = createApply({
    renderer,
    escape: async () => 'reload',
    report: () => {},
  })
  return { apply, renderer, components }
}

describe('absorb over the real renderer', () => {
  test("no candidate remounts from the renderer's registry", async () => {
    const { apply, renderer, components } = await live()
    class NextPage extends __Component { _create() { return null } }
    components.setCompiled('page.rip', { NextPage })

    expect(await apply.absorb(['page.rip'])).toBe('update')
    expect(renderer.current).toBeInstanceOf(NextPage)
  })

  test('a given candidate is the registry the remount reads', async () => {
    const { apply, renderer } = await live()
    class StagedPage extends __Component { _create() { return null } }

    expect(await apply.absorb(['page.rip'], registry({ 'page.rip': { StagedPage } }))).toBe('update')
    expect(renderer.current).toBeInstanceOf(StagedPage)
  })
})
