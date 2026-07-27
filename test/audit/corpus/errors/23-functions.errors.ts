// 23-functions.errors.ts — the line-aligned twin: tsgo's diagnostics here
// derive each expected code and position; @ts-nocheck quiets editors only.
// @ts-nocheck

function fetchCount(): Promise<number> {
  return Promise.resolve(9) }

let wrongPromised = (): Promise<number> => Promise.resolve('text')
let wrongHarvest: string = await fetchCount()
let wrongArrow: (n: number) => string = (n) => n
