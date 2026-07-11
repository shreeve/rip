let big, t1, t2;

let double = function(x) {
  return (x * 2);
};
let lazy = function() {
  return 42;
};
let d = double(4);
let r = (function(x) {
  return (x + 1);
})(5);
let z = apply(x => (x * 2), 1);
function m() {
  return (function(x) {
    return x;
  });
}
if (d > 5) {
  big = 1;
}
if (d > 5) {
  big = 2;
} else {
  big = 3;
}
while (d > 99) {
  d -= 1;
}
let label = "";
switch (d) {
  case 8:
    label = "eight";
    break;
  default:
    label = "other";
    break;
}
let chain = function(x) {
  let inner;
  x;
  return (inner = function() {
    return 2;
  });
};
if (d) {
  t1 = 1;
  t2 = 2;
}
let seq = (t1, t2);
if (d) {
  {
    t1;
    t2;
  };
}
let pick = function() {
  return (t1, t2);
};