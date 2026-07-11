function pick(a) {
  return (a ? a : 0);
}
let make = function(base) {
  this.base = base;
  (this.base++);
  let bump = n => (n + this.base);
  return bump(1);
};
let t1 = pick(3);
let t2 = i > 0 ? (i--) : (++i);
let check = function() {
  let flag = counter?.n ? 1 : 0;
  (flag++);
  return flag;
};
let s = t2 ? "some" : "none";
let u = counter?.n;
(i++);