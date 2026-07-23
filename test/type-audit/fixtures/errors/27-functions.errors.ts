// 27-functions.errors.ts — the line-aligned twin: tsgo's diagnostics here
// derive each expected code and position; @ts-nocheck quiets editors only.
// @ts-nocheck

function scale(amount: number): number {
  return amount * 2 }

function join(...parts: string[]): string {
  return parts.join('-') }

function notify(message: string) {
  console.log(message) }

function pick<T>(value: T): T {
  return value }

let label = 'seven'
let extra = 2

let wrongArgument = scale(label)
let wrongReturn: string = scale(3)
let wrongMissing = scale()
let wrongExtra = scale(extra, extra)
let wrongRest = join(extra)
let wrongVoid: number = notify(label)
let wrongPick: number = pick(label)
