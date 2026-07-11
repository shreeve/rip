let mk = function(o) {
  return o;
};
let add = function(a, b) {
  return (a + b);
};
let pair = function(a, b) {
  return [a, b];
};
let config = {name: "app", port: 8080};
let list = [1, 2, 3];
let sum = add(1, 2);
let mixed = [1, 2, 3, 4, 5];
let trail = {a: 1, b: 2};
let grid = [[1, 2], [3, 4]];
let recs = [{a: 1}, {b: 2}];
let data = {list: [1, 2], fn: mk(3)};
let holey = [1, 2];
let flat = {a: 1, b: 2};
let tight = [7, 8];
let sum2 = add(1, 2);
let made = mk({a: 1, b: 2});
let two = pair({a: 1}, {b: 2});
let chain = mk({name: "x"}).name;
let count = list.filter(function(n) {
  return (n > 1);
}).length;
let total = (1 + 2) + 3;
let avg = 1 + 2;
let join = function(a, b) {
  return (a + b);
};
function prod(x, y) {
  return (x * y);
}
let build = function() {
  return {a: 1, b: 2};
};
class Box {
  constructor(v) {
    this.v = v;
  }
  get(k) {
    return this.v[k];
  }
}
class SubBox extends Box {
  get(k) {
    let m = "get";
    return (super[m](k) + 1);
  }
}
let doubled = (() => {
  const result = [];
  for (let n of [10, 20]) {
    result.push((n * 2));
  }
  return result;
})();
let results = [config.port, list.length, sum, mixed.length, trail.b, grid[1][0], recs[0].a, data.list[1], data.fn, holey[1], flat.b, tight[1], sum2, made.b, two[1].b, chain, count, total, avg, join(2, 3), prod(4, 5), build().a, new SubBox({k: 9}).get("k"), doubled[1]];