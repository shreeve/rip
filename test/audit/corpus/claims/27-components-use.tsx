// 27-components-use.tsx — the twin: the same component imported from the sibling module.

import { Tag } from './27-components-lib'

function Board() {
  let clicks = 3

  return (
    <section>
      <Tag label={`${clicks} clicks`} tone='warn' />
      <Tag>plain</Tag>
    </section>
  )
}

console.log('use:', typeof Board, typeof Tag)
