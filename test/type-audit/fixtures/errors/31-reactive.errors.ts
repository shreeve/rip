// 31-reactive.errors.ts — the line-aligned twin: tsgo's diagnostics here
// derive each expected code and position; @ts-nocheck quiets editors only.
// @ts-nocheck

let count = 0
const limit = 100

let wrongState: number = 'oops'
const wrongComputed: string = count * 2
const wrongReadonly: number = 'nope'
const wrongEffect: number = (() => () => {})()
limit = 7
