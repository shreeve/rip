let flag, t;

function first(list) {
  return list[0];
}
function span(a, b) {
  return ((s, e) => Array.from({length: Math.abs(e - s) + 1}, (_, i) => s + (i * (s <= e ? 1 : -1))))(a, b);
}
let m1 = [1, 2].length;
let m2 = ({n: 5}).n;
let c1 = first([true, null]);
let c2 = [first, first][0]([7]);
let v1 = [(x ?? y), (2 ** 3)];
let v2 = {k: (x && y), m: ((s, e) => Array.from({length: Math.abs(e - s) + 1}, (_, i) => s + (i * (s <= e ? 1 : -1))))(1, 2)};
let ix = data[i + 1];
let sl = data.slice(1);
if (true) {
  t = ((s, e) => Array.from({length: Math.abs(e - s) + 1}, (_, i) => s + (i * (s <= e ? 1 : -1))))(1, 3);
}
while (flag && data[0]) {
  flag = false;
}
let q = span(1, 3);
[9, 9];