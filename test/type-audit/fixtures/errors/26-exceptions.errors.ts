// 26-exceptions.errors.ts — the line-aligned twin: tsgo's diagnostics here
// derive each expected code and position; @ts-nocheck quiets editors only.
// @ts-nocheck

let reasonCode = 500

let wrongMaybe: string = (() => { try { return 'value' } catch {} })()
let wrongUnion: number = (() => { try { return 'text' } catch (e) { return 0 } })()
let wrongBuilt = function() { throw new Error(reasonCode) }
let wrongAccess = function() {
  try {
    return 'ok'
  } catch (error) {
    return error.message } }
// (wrongPluck holds the open pattern-catch gap's TS2339, not a blessed
// negative — see FINDINGS.md; red here on a lowering change is the cue to
// invert it into 26-exceptions. The array spelling cannot derive in this
// lane — TS2488 anchors on the pattern's `[` — so check.test.js holds it.)
let wrongPluck = function() {
  try {
    return 'ok'
  } catch ({ message }) {
    return message } }
