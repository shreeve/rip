// 20-inference.errors.ts — the line-aligned twin: tsgo's diagnostics here derive each expected code and position.
// @ts-nocheck

let counts = [1, 2, 3]
let verdict = 'many'
let tally = 12

if (counts.length > 2) {
  var banner = 'wide' }

function scale(factor: number) {
  return (factor * 100) }

function describe() {
  return banner }

function introduceAll({ name, years: age }: { name: string, years: number }) {
  return `${name} is ${age}` }

tally = 'oops'

let wrongProduct: string = (counts.length * 2)
let wrongElements: string[] = counts.map((n) => (n * 2))
let wrongCallback = counts.map((n) => n.toUpperCase())
let wrongReturn: string = scale(2)
let wrongBranch: number = verdict
let wrongHoisted: number = describe()
let wrongDestructured = introduceAll({ name: 'Ada', years: 'old' })

let { json: media } = { json: 'app/json' }
function mediaType() {
  return media }
let wrongPatternHoisted: number = mediaType()
