// 21-operations.errors.ts — the line-aligned twin: tsgo's diagnostics here
// derive each expected code and position; @ts-nocheck quiets editors only.
// @ts-nocheck

let text = 'abc'
let count = 42
let point = { x: 1 }
let pair = function(a: number, b: number) { return a + b }

let wrongLeft = text * 2
let wrongRight = 2 * text
let wrongUpdate = text++
let wrongCompare = text === count
let wrongInstance = text instanceof count
let wrongCall = count()
let wrongOptionalCall = count?.(1)
let wrongArity = pair(1)
let wrongArgument = pair(1, text)
let wrongExist = missingName != null
let wrongDelete = delete point.x
