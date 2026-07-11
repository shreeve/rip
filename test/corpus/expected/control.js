let arr = [1, 2, 3];
let total = 0;
for (let x of arr) {
  total += x;
}
for (let i = 0; i < arr.length; i++) {
  let x = arr[i];
  total += x * i;
}
let obj = {a: 1, b: 2};
let keys = "";
for (let k in obj) {
if (!Object.hasOwn(obj, k)) continue;
keys += k;
}
for (let k in obj) {
let v = obj[k];
total += v;
}
for (let i = 1; i <= 3; i++) {
  total += i;
}
for (let x of arr) {
  if (x > 1) {
    total += x;
  }
}
let squares = (() => {
  const result = [];
  for (let x of arr) {
    result.push((x * x));
  }
  return result;
})();
let evens = (() => {
  const result = [];
  for (let x of arr) {
    if (((x % 2) === 0)) {
      result.push(x);
    }
  }
  return result;
})();
let names = (() => {
  const result = [];
  for (let k in obj) {
    result.push(k);
  }
  return result;
})();