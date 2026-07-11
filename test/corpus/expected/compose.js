let a, b2, b3, c5, t, x;

function pick(a, b) {
  return (a ?? b);
}
function powret(a) {
  return (2 ** a);
}
function bump(a) {
  return (a += 1);
}
let lit1 = true.toString;
let lit2 = undefined.toString;
let lit3 = f(true, false);
let lit4 = f(null, undefined);
let lit5 = null ?? undefined;
let u = pick(true, false);
let v = (x && y).toString;
let v2 = (x && y).z;
let w = (a ?? b)(1);
let r = f(x || y, !z);
let r2 = !x && y;
let p1 = (2 ** 3).toString;
let p2 = f(2 ** 3);
let s = 2 ** f(3);
let c1 = (a += 1).b;
let c2 = f(b2 += 1);
let q2 = b3 ??= 7;
let c3 = x &&= y;
let c4 = x ||= y;
c5 += f(9);
if (true) {
  t = null ?? 1;
}
while (v && w) {
  v = false;
}
while (!lit1) {
  lit1 = true;
}
let q = pick(2 ** 3, x **= 2);