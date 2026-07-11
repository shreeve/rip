let x = 0;
while (x < 5) {
  x += 1;
}
while (!(x === 2)) {
  x -= 1;
}
let t1 = typeof x;
let t2 = typeof {};
let obj = {a: 1, b: 2};
let deleted = delete obj.a;
let key = "b";
(delete obj[key]);
let t3 = typeof obj.a;
class Tool {
  kind() {
    return "tool";
  }
}
let tool = new Tool();
let i1 = tool instanceof Tool;
let i2 = {} instanceof Tool;
let g1 = (tool instanceof Tool) + 1;
let g2 = !(tool instanceof Tool);
let g3 = ("a" in {a: 1}) && true;
let g4 = 1 + typeof g3;
let g5 = typeof typeof g1;
let pickEnds = function(first, ..._rest) {
  const last = _rest[_rest.length - 1];
  return [first, last];
};
let ends = pickEnds(1, 2, 3, 4);
let lastOf = function(..._rest) {
  const z = _rest[_rest.length - 1];
  return z;
};
let l1 = lastOf(7, 8, 9);
let pairSum = 0;
let idxSum = 0;
for (let i = 0; i < [[1, 2], [3, 4]].length; i++) {
  let [a, b] = [[1, 2], [3, 4]][i];
  pairSum += a * b;
  idxSum += i;
}
let src = {a: 1, b: 2};
let doubled = (() => {
  const result = {};
  for (let k in src) {
    let v = src[k];
    result[k] = (v * 2);
  }
  return result;
})();
let vals = (() => {
  const result = [];
  for (let k in src) {
    let v = src[k];
    result.push(v);
  }
  return result;
})();
let hex = 0xff;
let big = 1_000_000;
let sci = 2.5e-3;
let api = {base: 10,
add(n) {
  return (this.base + n);
},
tag: s => ("t:" + s)};
let sum10 = api.add(5);
let tagged = api.tag("x");
let bits = 5 & 3;
bits |= 8;
bits ^= 1;
let shifted = (bits << 2) >> 1;
let flipped = (~bits) & 0xff;
let lanes = 1 | ((2 & 6) ^ 4);