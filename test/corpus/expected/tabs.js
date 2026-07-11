let double = function(x) {
  return (x * 2);
};
let label = "";
let n = 42;
if (n > 10) {
  if (n > 100) {
    label = "huge";
  } else {
    label = "big";
  }
} else {
  label = "small";
}
let total = 0;
for (let v of [1, 20, 300]) {
  total += double(v);
}
let msg = `${label}: ${total}`;
let conf = {name: "rip", size: total};
let who = {name: "tab", deep: {inner: 1}};