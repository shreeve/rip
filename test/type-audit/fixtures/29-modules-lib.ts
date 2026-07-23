// 29-modules-lib.ts — the module the 29-family imports: named exports (plain,
// typed, void), a local promoted through the specifier list, and the module
// default in its indented-object form

let station = 'relay'

export const host = 'localhost'
export const port: number = 4010
export const describe = function(): void { console.log('lib describes', host) }

export { station }

export default {
  theme: 'dark',
  depth: 2,
}

console.log('lib loaded:', station)
