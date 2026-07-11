let i = 0;
let j = 10;
(i++);
(++i);
(j--);
(--j);
let x = i++;
let y = j ? i : 0;
let z = i > 0 ? "pos" : "zero";
let counter = {n: 1};
let w = counter?.n;
let v = counter.n ? counter.n : 0;
let setup = function() {
  this.count = 0;
  (this.count++);
  return (this.name ? "anon" : this.name);
};