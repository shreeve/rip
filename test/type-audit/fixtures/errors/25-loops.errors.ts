// 25-loops.errors.ts — the line-aligned twin: tsgo's diagnostics here
// derive each expected code and position; @ts-nocheck quiets editors only.
// @ts-nocheck

let notIterable = 42
let plainObject = { a: 1 }
let words = ['alpha', 'beta']
let counts = [1, 2, 3].map((n) => n)

for (let wrongItem of notIterable) {
  console.log(wrongItem) }
for (let wrongKey in notIterable) {
  console.log(wrongKey) }
for (let wrongAs of notIterable) {
  console.log(wrongAs) }
for await (let wrongAwait of plainObject) {
  console.log(wrongAwait) }
for (let wrongFactor of words) {
  let wrongProduct = wrongFactor * 2 }
let wrongMember = words.map((w) => w.missing)
let wrongMath = counts.toUpperCase()
let wrongGuard = counts.filter((n) => n.length)
let supply = 2
let gathered = (() => { const got: number[] = []; while (supply-- > 0) {
  got.push(supply) }; return got })()
let wrongElement = gathered.toUpperCase()
