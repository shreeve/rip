// 25-components.errors.tsx — the line-aligned twin: tsgo's diagnostics derive each expected code and position; the ref and `<=>` rows have no honest TSX spelling, so they stay quiet here and are pinned on the rip side.
// @ts-nocheck
import { ComponentProps, useRef, Ref } from 'react'
class Knob {
  tally(step: number) { return step + 1 }

}

const knob = new Knob()
const wrongStep = knob.tally('nope')

type SwatchProps = ComponentProps<'input'> & { caption?: string }

function Swatch(props: SwatchProps) {
  return (
    <input {...props} />
  )
}
function Tint({ tone = 'info' }: { tone?: 'info' | 'warn' }) {
  return (
    <span>tint {tone}</span>
  )
}
function Palettes<TShade extends string>({ shades = [] }: { shades?: TShade[] }) {
  return (
    <div>palettes {shades.length}</div>
  )
}
function Liner({ inner }: { inner?: Ref<HTMLInputElement> }) {
  return (
    <input ref={inner} />
  )
}


function Shell() {
  const strictEl = useRef<HTMLInputElement | null>(null)
  const wrongTag = useRef<HTMLInputElement | null>(null)
  const wrongSleeve = useRef<HTMLDivElement | null>(null)

  return (
    <div>
      <Swatch placeholder={42} />
      <Tint tone={'nope'} />
      <Palettes shades={[1, 2]} />
      <div />
      <div />
      <Liner />
    </div>
  )
}
