// 13-components.tsx — the twin oracle for 13-components.rip.
// Gates, offer/accept, and the `<=>` channel have no honest TSX spelling and are deliberately absent, so the rip-native runtime line below is a PREDICTED trace, hand-replayed to keep the output byte-identical.

import { ComponentProps, MouseEventHandler, useRef } from 'react'

// ── Definition + typed props + render structure ──

type BadgeProps = {
  label: string
  tone?: 'info' | 'warn'
}

export function Badge({ label, tone = 'info' }: BadgeProps) {
  const shade = tone === 'warn' ? '#a60' : '#06f'

  return (
    <span className={`badge ${tone}`} style={{ color: shade }}>
      {label}
    </span>
  )
}

type FieldProps = ComponentProps<'input'> & {
  label?: string
  error?: string
}

function Field({ label, error, ...props }: FieldProps) {
  return (
    <div>
      {label && <label>{label}</label>}
      <input {...props} />
      {error && <div>{error}</div>}
    </div>
  )
}

// ── Render control flow, events, refs, keys, children ──

function Roster({ title, children }: { title?: string; children?: React.ReactNode }) {
  let people = ['Ada', 'Grace', 'Alan']
  let status = 'open'
  let query = ''
  const inputEl = useRef<HTMLInputElement | null>(null)
  const cap = 3

  const bump: MouseEventHandler = (e) => {
    console.log(e.clientX)
  }

  return (
    <section>
      <h1>{title}</h1>
      <span>{`${cap} max`}</span>
      <input ref={inputEl} defaultValue={query} />
      <button onClick={bump}>Inspect</button>
      <button onClick={(e) => console.log(e.type)}>Probe</button>
      {!people.length && <p>Nobody here</p>}
      {status === 'open' ? <span>Open</span> : status === 'closed' ? <span>Closed</span> : <span>Unknown</span>}
      <ul>
        {people.map((person) => (
          <li key={person}>{person}</li>
        ))}
      </ul>
      {children}
    </section>
  )
}

// ── Component use sites: props and children ──

export function Panel() {
  let text = ''
  let count = 0

  return (
    <div>
      <Field label='Name' value={text} />
      <Badge label={`${count} clicks`} tone='info' />
      <Roster title='Team'>
        <em>from the panel slot</em>
      </Roster>
    </div>
  )
}

// ── Generic components ──

function Chip<TLabel extends string>({ label }: { label?: TLabel }) {
  return <span>chip</span>
}

export function Options<TValue extends string>({ options = [] }: { options?: TValue[] }) {
  return (
    <div>
      {options.map((opt) => (
        <span key={opt}>{opt}</span>
      ))}
    </div>
  )
}

function Picker() {
  return (
    <div>
      <Chip label='alpha' />
      <Options options={['left', 'right']} />
    </div>
  )
}

// ── SVG elements ──

function Spinner() {
  let spinning = true

  return (
    <svg viewBox='0 0 24 24' className='animate-spin' fill='none'>
      <g className={['icon', 'spin'].filter(Boolean).join(' ')}>
        <circle cx='12' cy='12' r='10' />
      </g>
      <path className={`trail-${spinning}`} d='M4 12a8 8 0 0 1 8-8' />
    </svg>
  )
}

// ── render Expression: the logic-only component ──

function Quiet() {
  let note = 'silent'
  return null
}

function Terse() {
  return null
}

// ── hyphenated attribute keys: the presence road and the data- template ──

function Held() {
  let busy = false
  return (
    <div aria-busy={busy ? true : undefined} data-kind='row'>held</div>
  )
}

console.log('components:', typeof Badge, typeof Field, typeof Roster, typeof Panel, typeof Spinner)
console.log('generics:', typeof Chip, typeof Options, typeof Picker, typeof Quiet, typeof Terse, typeof Held)
console.log('rip-native constructs:', true, true, true)
