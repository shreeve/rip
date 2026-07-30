// 07-exceptions.errors.ts — the line-aligned twin: tsgo's diagnostics here derive each expected code and position.
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
