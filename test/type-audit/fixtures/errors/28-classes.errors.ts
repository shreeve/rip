// 28-classes.errors.ts — the line-aligned twin: tsgo's diagnostics here
// derive each expected code and position; @ts-nocheck quiets editors only.
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
class WrongBase extends notAClass {}
