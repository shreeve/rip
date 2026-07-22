// 24-conditionals.errors.ts — the line-aligned twin: tsgo's diagnostics here
// derive each expected code and position; @ts-nocheck quiets editors only.
// @ts-nocheck

let text = 'abc'
let count = 42
let point = { x: 1 }

let wrongTernary: number = count > 0 ? 'yes' : 0
let wrongDepth: number = count > 0 ? 'deep' :
  'shallow'
let wrongCompare = text === count ? 'same' : 'not'
let wrongGuard: string = 'on'
if (!(count > 0)) wrongGuard = 7
let wrongBranch: number = 0
if (count > 0) wrongBranch = 'nope'
let wrongToggle: boolean = true
if (!(count > 0)) {
  wrongToggle = 'off'
} else {
  wrongToggle = 'on' }
let wrongCase: number =
  (() => { switch (count) {
    case 1: case 2: return 'low'
    default: return 'high' } })()
let wrongProp = (() => { switch (point.z) {
  case 1: return 'one'
  default: return 'none' } })()
