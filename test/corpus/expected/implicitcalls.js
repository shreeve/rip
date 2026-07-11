let a, b, double;

double = function(x) {
  return (x * 2);
};
let add = function(a, b) {
  return (a + b);
};
let pick = function(xs) {
  return xs[0];
};
let run = function(f) {
  return f();
};
let each = function(xs, f) {
  return f(xs[0]);
};
let mk = function(x) {
  return (function(y) {
    return (x + y);
  });
};
a = double(4);
b = add(1, 2);
let c = add(a, double(b));
let d = double(double(3));
let e = double(add(1, 2));
let f2 = add(1, add(2, 3));
let s = "x,y,z";
let n = s.indexOf("y");
let m = s.split(",");
let o = m.slice(1);
let p = pick([7, 8]);
let q = pick([9]);
let rv = run(function() {
  return 5;
});
let ea = each(m, function(x) {
  return (x + "!");
});
let cu = mk(1)(2);
let g1 = double(-3);
let g2 = a - 3;
let w = 0;
if (double(2)) {
  w = 1;
}
let i = 30;
while (double(i > 99)) {
  i -= 1;
}
let sw = 0;
switch (double(2)) {
  case 4:
    sw = 1;
    break;
  default:
    sw = 2;
    break;
}
let h = 0;
if (b > 0) h = double(6);
let msg = `twice: ${double(5)}`;
let total = "";
for (let v of m) {
  total += pick([v]);
}
let len = s.split(",").length;
function tw(x) {
  return double(x);
}
let tv = tw(21);
let x1 = run(function() {
  return double(4);
});
let x2 = double(add(2, 3));
let y1 = 1 + double(2);
let y2 = !run(function() {
  return false;
});