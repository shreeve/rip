let double = function(x) {
  return (x * 2);
};
let fetchOne = async function() {
  return await Promise.resolve(41);
};
let addFetched = async function(a) {
  let base = await fetchOne();
  return (base + a);
};
let fatFetch = async k => await Promise.resolve(k);
let compute = async function() {
  let v = (await fetchOne()) ? "yes" : "no";
  let w = await Promise.resolve(2) + 3;
  return [v, w];
};
let grabStatus = async function() {
  let r = (await fetchOne()).toString();
  return r;
};
let collect = async function() {
  let vals = await (async () => {
    const result = [];
    for (let i of [1, 2, 3]) {
      result.push(await Promise.resolve(i));
    }
    return result;
  })();
  return vals;
};
let tryValue = async function() {
  let v = await (async () => { try {
    return await fetchOne();
  } catch (e) {
    return 0;
  } })();
  return v;
};
class Fetcher {
  async pull() {
    return await fetchOne();
  }
  sync() {
    return 7;
  }
}
let api = {async run() {
  return await fetchOne();
},
plain() {
  return 5;
}};
let counter = function*() {
  yield 1;
  return yield 2;
};
let delegate = function*() {
  return yield* counter();
};
let echoBack = function*() {
  let got = yield 1;
  return got;
};