// 09-classes.errors.ts — the line-aligned twin: tsgo's diagnostics here derive each expected code and position.
// @ts-nocheck

let notAClass = 42
class Gauge {
  level: number = 0
  constructor(level: number) {
    this.level = level } }

let wrongTarget = new notAClass()
let wrongArity = new Gauge()
let wrongMember = new Gauge(1).depth
let wrongKind: string = new Gauge(2)
let wrongQuery: typeof Gauge = new Gauge(3)
let wrongMaker: (new () => Gauge) = 'nope'
class WrongBase extends notAClass {}

class WrongSignal extends Gauge {
  read() { return super.missing } }
