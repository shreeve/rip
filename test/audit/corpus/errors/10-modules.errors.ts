// 10-modules.errors.ts — the line-aligned twin: tsgo's diagnostics here derive each expected code and position.
// @ts-nocheck

import wrongDefault from './answers-nothing.js'
import * as wrongSpace from './answers-nothing.js'
import { wrongNamed, wrongRenamed as wrongAliased } from './answers-nothing.js'

let target = './elsewhere.js'

let wrongMeta: number = import.meta.url
let wrongWhole: number = import.meta
let wrongPiece = import.meta.missing
let wrongEager: string = import(target)
export const wrongTyped: number = 'text'
export { target, target as aliasedTarget }
export { wrongAbsent }
// (a named import the module never exports cannot live in this lane: it needs
// a module BOTH judges resolve, and the editor side's workspace resolves only
// the flat fixture copies, the twin side's only its own errors/ twins. An
// unresolvable specifier is different — neither judge resolves it, so both
// publish the same TS2307, and the import rows above assert exactly that.)
