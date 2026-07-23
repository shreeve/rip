// 25-loops.ts — the loop family: while/until in block, guarded, postfix,
// and value spellings; loop and the counted loop; `for` over arrays (in),
// objects (of), and iterators (as / as! / for await); comprehensions

// ── while and until: the block forms ──

let count = 0
while (count < 3) {
  count++
}
let fuse = 4
while (!(fuse === 0)) {
  fuse--
}

console.log('blocks:', count, fuse)

// ── Guarded blocks: `when` rides the head; the condition drives progress ──

let budget = 6
let evens = 0
while (budget-- > 0) {
  if (budget % 2 === 0) {
    evens++
  }
}
let sand = 6
let tall = 0
while (!(sand-- === 0)) {
  if (sand > 3) {
    tall++
  }
}

console.log('guarded:', evens, tall)

// ── while as a value: the loop collects each iteration's result ──

let countdown = 3
let held = (() => {
  const got: number[] = []
  while (countdown > 0) {
    countdown--
    got.push(countdown)
  }
  return got
})()

console.log('held:', held)

// ── Postfix while/until on an expression, plain and guarded ──

let tick = 0
while (tick < 3) tick++
let tock = 6
while (!(tock === 0)) tock--
let cup = 6
let sips = 0
while (cup-- > 0) if (cup % 2 === 0) sips++
let jug = 6
let gulps = 0
while (!(jug-- === 0)) if (jug > 2) gulps++

console.log('postfix:', tick, tock, sips, gulps)

// ── Postfix while/until on a statement (`continue`), plain and guarded ──

let drain = [1, 2, 3]
while (drain.pop() != null) continue
let backlog = ['a', 'b']
while (!(backlog.shift() === undefined)) continue
let ticks = 3
while (ticks-- > 0) if (ticks % 2 === 0) continue
let grains = 3
while (!(grains-- <= 0)) if (grains > 1) continue

console.log('drained:', drain.length, backlog.length, ticks, grains)

// ── loop: the bare form runs until `break`; `loop n` counts with `it` ──

let spins = 0
while (true) {
  spins++
  if (spins === 3) {
    break
  }
}
let waves = (() => {
  const got: number[] = []
  for (let it = 0; it < 3; it++) {
    got.push(it * 10)
  }
  return got
})()

console.log('loop:', spins, waves)

// ── for…in over arrays: plain, guard, step, and the two guard/step orders ──

let scores = [3, 8, 5, 9]
for (let score of scores) {
  console.log('each:', score)
}
for (let score of scores) {
  if (score > 4) {
    console.log('high:', score)
  }
}
for (let _i = 0; _i < scores.length; _i += 2) {
  let even = scores[_i]
  console.log('stepped:', even)
}
for (let i = 0; i < scores.length; i += 2) {
  let late = scores[i]
  if (i > 1) {
    console.log('late:', late, i)
  }
}
for (let j = 0; j < scores.length; j += 2) {
  let peak = scores[j]
  if (peak > 4) {
    console.log('peak:', peak, j)
  }
}

// ── for…of over objects: keys, pairs, `own`, and guards ──

let ages: Record<string, number> = { ada: 36, grace: 45 }
for (let name in ages) {
  console.log('name:', name)
}
for (let elder in ages) {
  let age = ages[elder]
  if (age > 40) {
    console.log('elder:', elder, age)
  }
}
for (let key in ages) {
  if (!Object.hasOwn(ages, key)) continue
  console.log('own:', key)
}
for (let young in ages) {
  if (!Object.hasOwn(ages, young)) continue
  let years = ages[young]
  if (!(years < 40)) continue
  console.log('young:', young, years)
}

// ── for…as: the iterator protocol, sync and async (`for await` / `as!`) ──

let pulses = function*() {
  yield 2
  yield 4
  yield 6
  return 'rest'
}
for (let pulse of pulses()) {
  console.log('pulse:', pulse)
}
for (let strong of pulses()) {
  if (strong > 2) {
    console.log('strong:', strong)
  }
}
let feed = async function*() {
  await Promise.resolve()
  yield 10
  yield 25
  return 'done'
}
for await (let bite of feed()) {
  console.log('bite:', bite)
}
for await (let big of feed()) {
  if (big > 20) {
    console.log('big:', big)
  }
}
for await (let bang of feed()) {
  console.log('bang:', bang)
}
for await (let small of feed()) {
  if (small < 20) {
    console.log('small:', small)
  }
}

// ── Comprehensions over for…in: map, guard, step, and the two orders ──

let nums = [1, 2, 3, 4]
let doubled = nums.map((n) => n * 2)
let kept = nums.filter((n) => n > 2)
let ranked = nums.filter((_n, i) => i % 2 === 0)
let guardStep = nums.filter((n, i) => i % 2 === 0 && n > 1)
let stepGuard = nums.filter((n, i) => i % 2 === 0 && n > 1)

console.log('comprehend:', doubled, kept, ranked, guardStep, stepGuard)

// ── Comprehensions over for…of and for…as, `own` and guards included ──

let keyList = Object.keys(ages)
let elderList = Object.keys(ages).filter((k) => ages[k] > 40)
let ownList = Object.keys(ages).filter((k) => Object.hasOwn(ages, k))
let youngList = Object.keys(ages).filter((k) => Object.hasOwn(ages, k) && ages[k] < 40)
let louder = [...pulses()].map((p) => p * 10)
let several: number[] = [...pulses()].filter((p) => p !== 4)

console.log('object:', keyList, elderList, ownList, youngList)
console.log('iterator:', louder, several)

// ── Async comprehensions: `for await`, and the `as!` spelling ──

let bites = await (async () => { const got: number[] = []; for await (const b of feed()) got.push(b); return got })()
let bigBites = await (async () => { const got: number[] = []; for await (const b of feed()) if (b > 20) got.push(b); return got })()
let bangs = await (async () => { const got: number[] = []; for await (const b of feed()) got.push(b + 1); return got })()
let smallBangs = await (async () => { const got: number[] = []; for await (const b of feed()) if (b < 20) got.push(b); return got })()

console.log('async:', bites, bigBites, bangs, smallBangs)
