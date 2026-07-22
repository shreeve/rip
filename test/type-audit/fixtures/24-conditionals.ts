// 24-conditionals.ts — control flow that chooses: if/else-if/else and
// unless blocks, every postfix guard spelling, the if/else ternary, and
// switch/when — subjects, multi-value cases, condition-less cases, else

// ── if: bare, full chain, chain ending in else-if, and the inline then-else ──

let score = 72
let flags: string[] = []
if (score > 0) {
  flags.push('scored')
}
if (score > 90) {
  flags.push('gold')
} else if (score > 50) {
  flags.push('silver')
} else {
  flags.push('bronze')
}
if (score > 200) {
  flags.push('epic')
} else if (score > 60) {
  flags.push('solid')
}
let parity = score % 2 === 0 ? 'even' : 'odd'

console.log('flags:', flags, 'parity:', parity)

// ── unless: the block form, and unless/else ──

if (!(score > 100)) {
  flags.push('capped')
}
if (!(score > 50)) {
  flags.push('low')
} else {
  flags.push('high')
}

console.log('after unless:', flags)

// ── Postfix guards: statement and expression, if and unless ──

let describe = function(n: number) {
  if (n === 0) return 'zero'
  if (!(n >= 0)) return 'negative'
  if (n > 1000) console.log('describing:', n)
  if (!(n === 7)) n = n + 1
  return String(n)
}

console.log(describe(0), describe(-3), describe(7), describe(41))

// ── Ternary: the inline else, and the indented-else tail ──

let size = score > 50 ? 'big' : 'small'
let depth = score > 90 ? 'deep' :
  'shallow'

console.log('size:', size, 'depth:', depth)

// ── switch on a subject: single and multi-value whens, with and without else ──

let grade = (() => {
  switch (score) {
    case 100:
      return 'perfect'
    case 72:
    case 73:
      return 'expected'
    default:
      return 'other'
  }
})()
let mood = (() => {
  switch (parity) {
    case 'even':
      return 'calm'
    case 'odd':
      return 'wild'
  }
})()

console.log('grade:', grade, 'mood:', mood)

// ── Condition-less switch: the first true when wins ──

let tier = (() => {
  if (score > 90) {
    return 'high'
  } else if (score > 50) {
    return 'mid'
  } else {
    return 'low'
  }
})()
let band = (() => {
  if (score > 200) {
    return 'off the chart'
  } else if (score > 0) {
    return 'on the chart'
  }
})()

console.log('tier:', tier, 'band:', band)
