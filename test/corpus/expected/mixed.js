let msg;

function area(w, h) {
  return (w * h);
}
let total = area(3, 4) + area(5, 6);
if (total > 50) {
  msg = "big";
} else {
  msg = "small";
}
let result = obj.compute(total).value;