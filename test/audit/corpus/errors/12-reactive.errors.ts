// 12-reactive.errors.ts — the line-aligned twin: tsgo's diagnostics here derive each expected code and position; the two wrong-INITIALIZER lines are written as calls because a reactive's initializer is checked at one, and a plain declaration would model a different relation.
// @ts-nocheck

let count = 0
const limit = 100

let wrongState: number = ((v: number) => v)('oops')
const wrongComputed: string = ((): string => count * 2)()
const wrongReadonly: number = 'nope'
const wrongEffect: number = (() => () => {})()
limit = 7
