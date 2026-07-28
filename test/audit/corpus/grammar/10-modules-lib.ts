// 10-modules-lib.ts — the twin oracle for 10-modules-lib.rip.

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
