let xs = [1, 2, 3, 4];
let obj = {a: 1, b: 2, c: 3};
let evens = (() => {
  const result = [];
  for (let x of xs) {
    if (((x % 2) === 0)) {
      result.push(x);
    }
  }
  return result;
})();
let own1 = (() => {
  const result = [];
  for (let k in obj) {
    if (!Object.hasOwn(obj, k)) continue;
    result.push(k);
  }
  return result;
})();
let own2 = (() => {
  const result = [];
  for (let names in obj) {
    if (!Object.hasOwn(obj, names)) continue;
    if ((names !== "b")) {
      result.push(names);
    }
  }
  return result;
})();
let stepped = (() => {
  const result = [];
  for (let _i = 0; _i < xs.length; _i += 2) {
    let x = xs[_i];
    result.push(x);
  }
  return result;
})();
let steppedDown = (() => {
  const result = [];
  for (let _i = xs.length - 1; _i >= 0; _i--) {
    let x = xs[_i];
    result.push(x);
  }
  return result;
})();
let steppedGuard = (() => {
  const result = [];
  for (let _i = 0; _i < xs.length; _i += 2) {
    let x = xs[_i];
    if ((x > 1)) {
      result.push(x);
    }
  }
  return result;
})();
let indexed = (() => {
  const result = [];
  for (let i = 0; i < xs.length; i++) {
    let x = xs[i];
    result.push((x + i));
  }
  return result;
})();
let tailGuard = function(xs) {
  const _result = [];
  for (let x of xs) {
    if ((x > 1)) {
      _result.push((x * 2));
    }
  }
  return _result;
};
let tailIndexed = function(xs) {
  const _result = [];
  for (let i = 0; i < xs.length; i++) {
    let v = xs[i];
    _result.push((v + i));
  }
  return _result;
};
let tailOwn = function(m) {
  const _result = [];
  for (let name in m) {
    if (!Object.hasOwn(m, name)) continue;
    let id = m[name];
    if ((id >= 2)) {
      _result.push((name + id));
    }
  }
  return _result;
};
let tailStep = function(xs) {
  const _result = [];
  for (let _i = 0; _i < xs.length; _i += 2) {
    let v = xs[_i];
    _result.push((v * 10));
  }
  return _result;
};
let valueGuard = (() => {
  const result = [];
  for (let v of xs) {
    if ((v !== 2)) {
      result.push((v + 100));
    }
  }
  return result;
})();
let valueOwn = (() => {
  const result = [];
  for (let k in obj) {
    if (!Object.hasOwn(obj, k)) continue;
    let v = obj[k];
    if ((v > 1)) {
      result.push((k + v));
    }
  }
  return result;
})();
let sink = {};
for (let k in obj) {
  if (!Object.hasOwn(obj, k)) continue;
  let v = obj[k];
  sink[k] = v;
};
let sums = [];
for (let [a, b] of [[1, 2], [3, 4]]) {
  if ((a > 0)) {
    sums.push(a + b);
  }
};
let r1 = tailGuard(xs);
let r2 = tailIndexed(xs);
let r3 = tailOwn(obj);
let r4 = tailStep(xs);