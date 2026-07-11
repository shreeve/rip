let limit;

limit = 10;
let appName = "rip";
let ratio = 3.14;
let flags = {a: 1};
let pick = function(n) {
  return (n + 1);
};
function clamp(v, lo = 0, hi = limit) {
  let w = (v < lo) ? lo : v;
  return ((w > hi) ? hi : w);
}
let scale = function(factor, ...rest) {
  return (factor + rest.length);
};
let pair = function({a, b} = {a: 2, b: 3}) {
  return (a * b);
};
let double = function(x) {
  return (x * 2);
};
let total = (((clamp(12) + scale(2, 9, 9)) + pair()) + double(4)) + pick(1);
let cast1 = total;
let cast2 = cast1 + 1;
let list = [1, 2, 3];
let sum = 0;
for (let n of list) {
  sum += n;
};
let label = `${appName}:${limit}`;