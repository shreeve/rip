let a = 5;
let b = 0;
if (a > 2) b = 1;
let c = 0;
if (!(a > 2)) c = 2;
let early = function() {
  if (a > 4) return "early";
  return "late";
};
let got = early();
let d = Array.isArray([1, 5]) || typeof [1, 5] === 'string' ? [1, 5].includes(a) : (a in [1, 5]);
let e = "x" in {x: 1};
let f = 3;
if (d) (f--);