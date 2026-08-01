// 13-components.errors.tsx — the line-aligned twin: tsgo's diagnostics derive each expected code and position; the bind and ref rows stay quiet here and are pinned on the rip side, and the Gated class spells the mount: never contract the gated lowering mints.
// @ts-nocheck

type ChipProps = {
  label?: string
  count?: number
}
function Chip(props: ChipProps) {
  return <span>chip</span>
}
class Gated {
  private constructor() { }

  static mount: never
  static part = 'gated'
}
function Wrong() {
  const wrongCell: HTMLInputElement | null = null
  const amount = 0

  return (
    <div>
      <Chip label={123} />
      <Chip count={'five'} />
      <div />
      <Chip
        label={'quiet'} />
      {wrongTypo &&
        <span>unreachable</span>}
      {wrongText &&
        <span>fallback</span>}
    </div>
  )
}
const wrongMount = Gated.mount()
const wrongConstruct = new Gated({})

function Member() {
  const wrongPlain: string = 42
  const wrongState: number = 'oops'
  const wrongComputed: string = 7 * 3
  const wrongConst: number = 'nope'
  let ok = 0

  const bump = () => {
    ok = 'later'
  }

  return <div>{ok}</div>
}
