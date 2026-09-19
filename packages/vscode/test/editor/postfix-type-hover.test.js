// The postfix type operators in the editor: `x as T` and `x satisfies T`
// each collapse to one opaque token, and the words inside answer the way
// an annotation's do (the positive hover model, hoverableSpans in
// translate.js), take semantic tokens on their own Rip span, and a
// satisfies mismatch lands where TypeScript itself anchors it.
import { test, expect, describe } from 'bun:test'
import { tsgoAvailable, inWorkspace, decodeSemanticTokens } from './support/harness.mjs'

const withFile = (text, fn) => inWorkspace({}, async (api) => {
  await api.open('a.rip', text)
  await fn({
    legend: api.capabilities.semanticTokensProvider.legend,
    hover: (line, character) => api.hover('a.rip', line, character),
    semanticTokens: () => api.semanticTokens('a.rip'),
    diagnostics: () => api.diagnostics('a.rip'),
  })
}, { prefix: 'rip-postfix-' })

describe.skipIf(!tsgoAvailable)('postfix type operators in the editor', () => {
  const SRC = 'type Wide = string | number\nraw = JSON.parse("1")\na = raw as Wide\nb = 1 satisfies Wide\n'

  test('the type word of `x as T` and of `x satisfies T` hovers the alias; the operator word declines', async () => {
    await withFile(SRC, async (api) => {
      const cast = await api.hover(2, 12)        // `Wide` in `raw as Wide`
      expect(cast?.contents?.value ?? null).toContain('type Wide = string | number')
      const sat = await api.hover(3, 17)         // `Wide` in `1 satisfies Wide`
      expect(sat?.contents?.value ?? null).toContain('type Wide = string | number')
      expect(await api.hover(2, 9)).toBeNull()   // the `as` word
      expect(await api.hover(3, 6)).toBeNull()   // the `satisfies` word
    })
  }, 30000)

  test('the type word of each operator carries a semantic token on its own Rip span', async () => {
    await withFile(SRC, async (api) => {
      const tokens = decodeSemanticTokens((await api.semanticTokens()).data, api.legend)
      expect(tokens.some((t) => t.line === 2 && t.character === 11 && t.length === 4 && t.type === 'type')).toBe(true)
      expect(tokens.some((t) => t.line === 3 && t.character === 16 && t.length === 4 && t.type === 'type')).toBe(true)
    })
  }, 30000)

  test('a satisfies mismatch reports where TypeScript anchors it: a whole-shape miss on the keyword, a field miss on the field', async () => {
    // tsc's own anchors for the same program: TS2741 on the `satisfies`
    // token, TS2322 on the mismatched property's name.
    await withFile('type Entry = { href: string, name: string }\nx = { href: "/a" } satisfies Entry\ny = { href: "/a", name: 3 } satisfies Entry\n', async (api) => {
      const shape = api.diagnostics().find((m) => m.code === 2741)
      expect(shape).toBeDefined()
      expect(shape.range.start).toEqual({ line: 1, character: 19 })
      expect(shape.range.end).toEqual({ line: 1, character: 28 })
      const field = api.diagnostics().find((m) => m.code === 2322)
      expect(field).toBeDefined()
      expect(field.range.start).toEqual({ line: 2, character: 18 })
      expect(field.range.end).toEqual({ line: 2, character: 22 })
    })
  }, 30000)
})
