// 32-components.errors.tsx — the line-aligned twin: tsgo's diagnostics here
// derive each expected code and position. The bind and ref rows have no
// honest TSX spelling and are pinned on the rip side (error-pins.json), so
// their lines stay quiet here; the Gated class spells the designed contract
// (mount: never, private constructor) the gated lowering mints.
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
