let edge, last;

let i = 0;
let evens = [];
while ((i += 1) < 8) {
  if ((i % 2) === 0) {
    evens.push(i);
  }
}
let j = 10;
let downs = [];
while (!((j -= 1) <= 4)) {
  if ((j % 2) === 1) {
    downs.push(j);
  }
}
let k = 0;
let vals = (() => {
  const result = [];
  while ((k += 1) < 5) {
    if (!(k !== 2)) continue;
    result.push((k * 3));
  }
  return result;
})();
let m = 0;
while ((m += 1) < 6) {
  if (m > 3) {
    last = m;
  }
}
let n = 9;
while (!((n -= 2) < 3)) {
  if (n > 4) {
    edge = n;
  }
}
let sum = (((evens.length + downs.length) + vals.length) + last) + edge;