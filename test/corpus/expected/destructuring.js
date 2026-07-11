let a, a1, aOut, b, b1, c1, c2, head, keep, m1, others, ren, sd, tail, x1, y1, z1;

let pair = [1, 2];
let obj = {a: 10, b: 20};
[a1, b1] = pair;
({a, b} = obj);
({a: ren, b: keep} = obj);
[x1, [y1, z1]] = [7, [8, 9]];
({m1 = 5} = {a: 3});
[x1, y1] = [y1, x1];
[head, ...tail] = [1, 2, 3, 4];
({a: aOut, ...others} = {a: 1, b: 2, c: 3});
let sum = function(...nums) {
  let t = 0;
  for (let n of nums) {
    t += n;
  }
  return t;
};
let s1 = sum(1, 2, 3);
let s2 = sum(...[4, 5]);
let s3 = sum(1, ...[2, 3], 4);
let joined = [0, ...pair, 9];
let dflt = function(v = 42) {
  return v;
};
let d1 = dflt();
let d2 = dflt(7);
let pick = function({a, b}) {
  return (a + b);
};
let p1 = pick({a: 1, b: 2});
let second = function([f2, s2x]) {
  return s2x;
};
let p2 = second([3, 4]);
let caught2 = 0;
try {
  throw [1, 2];
} catch (error) {
  ([c1, c2] = error);
  caught2 = c2;
}
let total = 0;
for (let [k, v] of [[1, 2], [3, 4]]) {
  total += k * v;
}
let names = "";
for (let {a: nm} of [{a: "x"}, {a: "y"}]) {
  names += nm;
}
let pd1 = function([a3 = 1]) {
  return a3;
};
let pd2 = function(x3 = 1, [y3 = 2]) {
  return (x3 + y3);
};
let pd3 = function({w = 9}) {
  return w;
};
let dv1 = pd1([]);
let dv2 = pd2(5, [6]);
let dv3 = pd3({});
let dfor = 0;
for (let [q = 7] of [[], [2]]) {
  dfor += q;
}
[{sd = 8}] = [{}];
let comp = (() => {
  const result = [];
  for (let [a2, x2] of [[1, 2], [3, 4]]) {
    result.push(x2);
  }
  return result;
})();