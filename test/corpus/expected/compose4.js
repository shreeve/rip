function sum(list) {
  let total = 0;
  let parts = (() => {
    const result = [];
    for (let n of list) {
      result.push(n);
    }
    return result;
  })();
  total = parts.length;
  return total;
}
let s = sum([1, 2, 3]);
let v = (() => {
  const result = [];
  for (let n = 1; n <= 3; n++) {
    result.push((n * 2));
  }
  return result;
})();
let w = v[0];
let label = "";
switch (s) {
  case 6:
    label = "six";
    break;
  default:
    label = "other";
    break;
}
let caught = 0;
try {
  missing();
} catch (err) {
  if (err) caught = 1;
}
let u = ((k, c) => Array.isArray(c) || typeof c === 'string' ? c.includes(k) : k in c)(s, [5, 6]);
while (true) {
  s -= 1;
  if (!(s > 0)) break;
}
if (u) (s++);