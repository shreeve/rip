let items = [1, 2, 3];
let pairs = [[1, 2], [3, 4]];
let seen = [];
for (let x of items) {
  seen.push(x);
}
for (let x of items) {
  if (x > 1) {
    seen.push(x * 10);
  }
}
for (let [a, b] of pairs) {
  seen.push(a + b);
}
for (let [a, b] of pairs) {
  if (a > 1) {
    seen.push(a * b);
  }
}
for (let x of items) {
  seen.push(x);
};
for (let x of items) {
  if ((x > 2)) {
    seen.push(x + 1);
  }
};
let doubled = (() => {
  const result = [];
  for (let x of items) {
    result.push((x * 2));
  }
  return result;
})();
let picked = (() => {
  const result = [];
  for (let x of items) {
    if ((x !== 2)) {
      result.push(x);
    }
  }
  return result;
})();
let total = 0;
(() => {
  const result = [];
  for (let x of doubled) {
    result.push((total += x));
  }
  return result;
})();