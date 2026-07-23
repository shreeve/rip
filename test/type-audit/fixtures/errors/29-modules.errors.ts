// 29-modules.errors.ts — the line-aligned twin: tsgo's diagnostics here
// derive each expected code and position; @ts-nocheck quiets editors only.
// @ts-nocheck

let target = './elsewhere.js'

let wrongMeta: number = import.meta.url
let wrongWhole: number = import.meta
let wrongPiece = import.meta.missing
let wrongEager: string = import(target)
export const wrongTyped: number = 'text'
// (import-RESOLUTION negatives — a named import the module never exports, a
// specifier no file answers — cannot live in this lane: the editor side's
// workspace resolves only the flat fixture copies, the twin side's only its
// own errors/ twins, so no specifier resolves for both judges at once.)
