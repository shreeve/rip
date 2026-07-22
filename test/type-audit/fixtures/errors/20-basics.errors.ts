// 20-basics.errors.ts — the line-aligned twin: tsgo's diagnostics here
// derive each expected code and position; @ts-nocheck quiets editors only.
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
