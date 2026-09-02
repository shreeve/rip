// 27-components-lib.tsx — the twin: the exported component the use twin imports.

import type { ReactNode } from 'react'

export function Tag({ label = '', tone = 'info', children }: { label?: string; tone?: 'info' | 'warn'; children?: ReactNode }) {
  return (
    <span className={tone}>
      {label}
      {children}
    </span>
  )
}

console.log('lib:', typeof Tag)
