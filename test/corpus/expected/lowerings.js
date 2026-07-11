let p1, p2, p3;

let flag = true;
let n = 7;
let t1 = flag ? 1 : 2;
let t2 = flag ? 1 : undefined;
let t3 = !flag ? 1 : 2;
let t4 = (n > 5) ? "big" : ((n > 2) ? "mid" : "small");
let t5 = (flag ? 1 : 2) + 3;
let t6 = [(flag ? 10 : 20), 30];
let seen = "";
let m1 = (() => { if (flag) {
  seen += "a";
  return (n + 1);
} else {
  return 0;
} })();
p1 = (flag ? 5 : 6);
p2 = (n > 100 ? (n + 1) : (n - 1));
let double = function(x) {
  return (x * 2);
};
p3 = (flag ? double(n) : 0);
let risky = function() {
  throw "bad";
};
let tv = (() => { try {
  return risky();
} catch (e) {
  return "caught";
} })();
let sw = (() => { switch (n) {
  case 7:
    return "seven";
  default:
    return "other";
} })();
let i = 0;
let acc = (() => {
  const result = [];
  while (i < 3) {
    i += 1;
    result.push((i * 10));
  }
  return result;
})();
let evens = (() => {
  const result = [];
  for (let v of [1, 2, 3, 4]) {
    result.push((v * 2));
  }
  return result;
})();
let lp = (() => {
  const result = [];
  while (true) {
    break;
  }
  return result;
})();
let sum = 0;
let tally = function(v) {
  return (sum += v);
};
for (let v of [1, 2, 3]) {
  tally(v);
};
let tailIf = function(v) {
  return ((v > 0) ? "pos" : "neg");
};
let tailMulti = function(v) {
  let w;
  if ((v > 0)) {
    w = v * 2;
    return (w + 1);
  } else {
    return 0;
  }
};
let tailTry = function() {
  return (() => { try {
    return risky();
  } catch (e) {
    return 42;
  } })();
};
let tailSwitch = function(v) {
  return (() => { switch (v) {
    case 7:
      return "lucky";
    default:
      return "plain";
  } })();
};
let tailFor = function(xs) {
  const _result = [];
  for (let x of xs) {
    _result.push((x + 100));
  }
  return _result;
};
let results = [t1, t2, t3, t4, t5, m1, p1, p2, p3, tv, sw, acc, evens, sum, tailIf(n), tailMulti(2), tailTry(), tailSwitch(7), tailFor([1])];