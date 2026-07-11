let grammar = {options: {a: 1, b: 2}};
let deep = {x: {y: {z: 9}}};
let extra = {c: 3};
let opts = {...grammar.options, ...extra};
let merged = {...deep.x.y, w: 0};
let both = {base: 1, ...grammar.options, ...deep.x.y};
let inCall = Object.keys({...grammar.options});
let make = function(n) {
  return {v: n, n: (n * 2)};
};
let wrap = function(o) {
  return {inner: o};
};
let fromCall = {...make(3), tag: "c"};
let fromChain = {...wrap(make(1)).inner, more: true};
let table = {k1: {a: 1}, k2: {b: 2}};
let key = "k1";
let fromIndex = {...table[key]};
let idxChain = {...wrap(table)["inner"].k2, w: 9};
let optChain = {...table?.k2};
let fromParen = {...(table.k2 || {}), extra: 4};
let fromObject = {...{lit: 5}, lit2: 6};
let carrier = {v: 7,
dup() {
  return {...this};
}};
let fromThis = {got: carrier.dup().v, size: Object.keys(carrier.dup()).length};
let nested = {outer: {...make(4), o: 1}};
let inArg = Object.keys({...make(5), z: 1}).length;
let comp = (() => {
  const result = [];
  for (let i of [1, 2]) {
    result.push({...make(i), i: i});
  }
  return result;
})();
let conf = {...make(2), on: true};