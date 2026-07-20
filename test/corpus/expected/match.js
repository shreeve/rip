let _;

(_ = toMatchable("m0").match(/m(0)/));
let top = _[1];
let grab = function(s) {
  let _;
  (_ = toMatchable(s).match(/x(\w+)/));
  return _[1];
};
let indexed = function(v) {
  let _;
  return ((_ = toMatchable(v).match(/^([1-9]\d*)$/)) && _[1]);
};
let reader = function() {
  let _;
  (_ = toMatchable("ab").match(/a(b)/));
  let read = function() {
    return _[1];
  };
  return read();
};
let branchy = function(s) {
  let _;
  let r = (_ = toMatchable(s).match(/q(\d)/)) ? _[1] : "none";
  return r;
};
let sieve = function(xs) {
  let _;
  let hits = (() => {
    const result = [];
    for (let x of xs) {
      if ((_ = toMatchable(x).match(/a(\w)/))) {
        result.push(x);
      }
    }
    return result;
  })();
  return [hits.length, _[1]];
};
let looped = function(xs) {
  let _;
  for (let x of xs) {
    (_ = toMatchable(x).match(/v(\d)/));
  }
  return _[1];
};
class Cap {
  grab(s) {
    let _;
    (_ = toMatchable(s).match(/c(\w)/));
    return _[1];
  }
}
let param = function(_) {
  (_ = toMatchable("zz").match(/z(z)/));
  return _[1];
};
let after = (_ = toMatchable("a").match(/(a)/)) !== null;
_ = 5;