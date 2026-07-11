let calls = [];
(function() {
  calls.push(1);
  return calls.push(2);
})();
let x = (function() {
  return (40 + 2);
})();
let y = (function(n = 5) {
  return (n * 2);
})();
let mk = function() {
  return 7;
};
let z = (mk)();
let w = (function() {
  return (function() {
    return 9;
  })();
})();
let composed = (function() {
  return 3;
})() + (function() {
  return 4;
})();