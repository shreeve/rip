// 20-basics.errors.ts — the asserted-diagnostics twin, LINE-ALIGNED. tsgo's own
// diagnostics on this file fix each expected code and line, and the flagged
// token's position in the rip source fixes the expected column. The
// pragma below quiets the EDITOR only — the lane strips it, and enforces it.
// @ts-nocheck

let wrongNumber: number = 'nope'
let wrongString: string = 42
let wrongBoolean: boolean = 'yes'
let wrongRegex: string = /ab+c/g
let wrongSymbol: string = Symbol.for('alpha')
let wrongParenthetical: string = (1 + 2) * 3
let wrongIife: string = (function() { return 42 })()
let wrongInterpolation: number = `sum ${1 + 2}`
let wrongProperty = 'abc'.missing
