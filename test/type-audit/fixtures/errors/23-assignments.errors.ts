// 23-assignments.errors.ts — the line-aligned twin: tsgo's diagnostics here
// derive each expected code and position; @ts-nocheck quiets editors only.
// @ts-nocheck

let text = 'abc'
let port: number = 3000
let point = { x: 1 }
let box = { size: 1 }
text -= 1
port = 'high'
text = text.missing()
Object.assign(box ??= {}, { size: 'big' })

let wrongMaybe: number = 'nine'
let { absent } = point
let wrongPick = { got: point.absent2 }
