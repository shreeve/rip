let n = 2;
let label = "";
switch (n) {
  case 1:
    label = "one";
    break;
  case 2:
  case 3:
    label = "few";
    break;
  default:
    label = "many";
    break;
}
let big = 0;
if ((n > 10)) {
  big = 1;
} else {
  big = 0;
}
let result = "";
let done = 0;
try {
  result = risky();
} catch (e) {
  result = "err";
} finally {
  done = 1;
}
let ignored = 0;
try {
  f();
} catch {
  ignored = 1;
}
let x = 0;
while (true) {
  x += 1;
  if (x > 2) break;
}