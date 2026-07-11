let arr = [1, 2, 3, 4];
let obj = {a: 1, b: 2};
let t = 0;
for (let _i = 0; _i < arr.length; _i += 2) {
let x = arr[_i];
if ((x > 1)) {
    t += x;
  }
}
for (let _i = 0; _i < arr.length; _i += 2) {
let x = arr[_i];
if ((x > 1)) {
    t += x;
  }
}
for (let _i = 0; _i < arr.length; _i += 2) {
let x = arr[_i];
t += x;
}
for (let i = 0; i < arr.length; i++) {
  let x = arr[i];
  if (x) {
    t += i;
  }
}
for (let k in obj) {
let v = obj[k];
if ((v > 0)) {
t += v;
  }
}
for (let k in obj) {
if (!Object.hasOwn(obj, k)) continue;
let v = obj[k];
if (k) {
t += 1;
  }
}
for (let k in obj) {
if (!Object.hasOwn(obj, k)) continue;
let v = obj[k];
t += 1;
}
for (let x of arr) {
  if (x > 2) {
    t += x;
  }
}
for (let _i = arr.length - 1; _i >= 0; _i--) {
let x = arr[_i];
t += x;
}
for (let _i = arr.length - 1; _i >= 0; _i += (-2)) {
let x = arr[_i];
t += x;
}
for (let i = arr.length - 1; i >= 0; i--) {
let x = arr[i];
t += x + i;
}