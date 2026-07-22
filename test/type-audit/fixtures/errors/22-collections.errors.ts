// 22-collections.errors.ts — the line-aligned twin: tsgo's diagnostics here
// derive each expected code and position; @ts-nocheck quiets editors only.
// @ts-nocheck

let person = { name: 'ada' }
let list = [1, 2, 3]
let count = 42
let scores = new Map([['alpha', 1]])

let wrongElement = list[0].toUpperCase()
let wrongProperty = person.missing
let wrongIndex = list[person]
let wrongArraySpread = [...count]
let wrongIterable = [...person]
let wrongRange: string[] = Array.from({ length: 3 }, (_, i) => i + 1)
let wrongSlice = list.slice(0, count.length + 1)
let wrongMapProp = scores.alpha
let wrongMapValue: string = scores.get('alpha')
let wrongPick: { name: number } = { ...{ name: person.name } }
