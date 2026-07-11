let add = function(a, b) {
  return (a + b);
};
let double = x => (x * 2);
let zero = function() {
  return 0;
};
let lazy = () => 42;
let sum = add(1, 2);
let d = double(4);
let inner = function(h) {
  return h(zero());
};
let seq = function() {
  1;
  return 2;
};