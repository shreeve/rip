// 25-components.tsx — the TSX analogy twin (CORPUS.md, Oracles), by symbol name, never line parity.
// Methods spell as a class: React function components have no member-method concept.
// Cuff passes its cell as an ordinary ref prop: no TSX line spells the `<=>` channel.

import { ComponentProps, useRef, Ref } from 'react'

// ── Method faces: typed parameters, an optional defaulted parameter, and the body's return reaching the caller ──

class Dial {
  reading = 0

  tally(step: number, label = 'unit') { return `${label}:${step}` }

  spanning(step: number) {
    const doubled = step * 2
    return doubled + 1
  }
}

const probe = new Dial()
const tallied: string = probe.tally(2)
const spanned: number = probe.spanning(3)
const dialled: string = probe.tally(4, 'step')

console.log('methods:', tallied, spanned, dialled)

// ── Intrinsics forward from the element the component extends ──

type PromptProps = ComponentProps<'input'> & { caption?: string }

function Prompt({ caption, ...props }: PromptProps) {
  return <input {...props} />
}

// ── A literal-union prop keeps its union at the use site ──

function Ribbon({ tone = 'info' }: { tone?: 'info' | 'warn' }) {
  return <span>ribbon {tone}</span>
}

// ── A generic component's constraint governs the use site ──

function Palette<TShade extends string>({ shades = [] }: { shades?: TShade[] }) {
  return <div>palette {shades.length}</div>
}

function Stage() {
  return (
    <div>
      <Prompt placeholder='type here' />
      <Ribbon tone='warn' />
      <Palette shades={['dawn', 'dusk']} />
    </div>
  )
}

// ── Ref-cell nullability: a tag-typed cell takes its own tag, a broad cell takes any ──

function Anchors() {
  const promptEl = useRef<HTMLInputElement | null>(null)
  const anyEl = useRef<HTMLElement | null>(null)

  return (
    <div>
      <input ref={promptEl} />
      <section ref={anyEl} />
    </div>
  )
}

// ── A forwarded element ref: the child's own ref lands in the parent's cell ──

function Sleeve({ inner }: { inner?: Ref<HTMLInputElement> }) {
  return <input ref={inner} />
}

function Cuff() {
  const sleeveEl = useRef<HTMLInputElement | null>(null)

  return (
    <div>
      <Sleeve inner={sleeveEl} />
    </div>
  )
}

console.log('use sites:', typeof Prompt, typeof Ribbon, typeof Palette, typeof Stage)
console.log('refs:', typeof Anchors, typeof Sleeve, typeof Cuff)

// ── A method's write to a field checks against its declared type, and an array field keeps its element type ──

class Ledger {
  entries: string[] = ['open']
  status = 'idle'

  post(note: string) {
    this.status = note
    this.entries = [note]
  }
}

const ledger = new Ledger()
const ledgerHead: string = ledger.entries[0]
const ledgerStatus: string = ledger.status

console.log('state:', ledgerHead, ledgerStatus)

// ── Member kinds through an instance: a mutable field, a readonly field, a plain field, and a getter typed from what its body reads ──

class Meter {
  labels = ['idle']
  readonly cap = 3
  note = 'flat'

  get width() { return this.labels.length }

  get span() {
    const base = this.labels.length
    return base + this.cap
  }
}

const meter = new Meter()
const meterWidth: number = meter.width
const meterSpan: number = meter.span
const meterLabel: string = meter.labels[0]
const meterCap: number = meter.cap
const meterNote: string = meter.note

console.log('members:', meterWidth, meterSpan, meterLabel, meterCap, meterNote)
