// 10-modules.ts — the twin oracle for 10-modules.rip.

// ── import heads: side-effect, default, namespace, empty and named lists ──

import './10-modules-lib'
import theme from './10-modules-lib'
import * as lib from './10-modules-lib'
import {} from './10-modules-lib'
import { host } from './10-modules-lib'
import { port as libPort, station } from './10-modules-lib'
import { default as sameTheme } from './10-modules-lib'

console.log('imports:', theme.depth, lib.port, host, libPort, station, sameTheme.theme)

// ── combined heads: default beside a namespace, default beside a list ──

import combo, * as whole from './10-modules-lib'
import paired, { describe } from './10-modules-lib'

describe()
console.log('combined:', combo.theme, whole.host, paired.depth)

// ── type-only heads: named, default, namespace, empty — the statement erases whole, module load included ──

import type { Parcel } from './10-modules-lib'
import type themeShape from './10-modules-lib'
import type * as libShapes from './10-modules-lib'
import type {} from './10-modules-lib'

let manifest: Parcel = { size: 7 }
let crate: typeof themeShape = { theme: 'dim', depth: 1 }
let cargo: libShapes.Parcel = { size: 2 }

console.log('type-only:', manifest.size, crate.depth, cargo.size)

// ── multiline specifier lists: the indented block, and the carried tail ──

import {
  host as blockHost,
  port as blockPort,
} from './10-modules-lib'
import { station as tailStation, describe as tailDescribe } from './10-modules-lib'

console.log('layouts:', blockHost, blockPort, tailStation, typeof tailDescribe)

// ── the hub and the alias consumed: resold names, resold defaults ──

import hubTheme from './10-modules-hub'
import { host as hubHost } from './10-modules-hub'
import accents from './10-modules-alias'

console.log('resold:', hubTheme.theme, hubHost, accents.accent)

// ── exported bindings: plain, typed, void — inline, carried, indented ──

export const plainFlag = 'direct'
export const carriedFlag =
'carried'
export const droppedFlag =
  'indented'
export const typedFlag: string = 'typed direct'
export const typedCarried: string =
'typed carried'
export const typedDropped: string =
  'typed indented'
export const announce = function(): void { console.log('announce ran') }
export const announceCarried =
function(): void { console.log('announce carried ran') }
export const announceDropped =
  function(): void { console.log('announce indented ran') }

announce()
announceCarried()
announceDropped()
console.log('bindings:', plainFlag, carriedFlag, droppedFlag, typedFlag, typedCarried, typedDropped)

// ── local export lists: empty, single, aliased pairs, and both layouts ──

let sectionA = 'alpha'
let sectionB = 'beta'
let sectionC = 'gamma'
let sectionD = 'delta'
let sectionE = 'epsilon'
let sectionF = 'zeta'

export {}
export { sectionA }
export { sectionB as second, sectionC }
export {
  sectionD,
  sectionE as blockE,
}
export { sectionF, sectionA as tailA }

console.log('sections:', sectionA, sectionB, sectionC, sectionD, sectionE, sectionF)

// ── re-exports through specifier lists: empty, aliased, the default resold ──

export {} from './10-modules-lib'
export { host as resoldHost, station as resoldStation } from './10-modules-lib'
export { default as resoldTheme } from './10-modules-lib'

// ── export default: the expression form ──

export default host.toUpperCase()

// ── dynamic import: the promise form awaited inline, and the bang form ──

let lazyHost = (await import('./10-modules-lib')).host
let bangPort = (await import('./10-modules-lib')).port

console.log('dynamic:', lazyHost, bangPort)

// ── import.meta: the module knows its own address ──

console.log('meta:', import.meta.url.includes('10-modules'))
