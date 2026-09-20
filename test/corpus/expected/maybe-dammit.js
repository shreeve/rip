let fetchUser = function(id) {
  return Promise.resolve({id: (id ?? 0)});
};
let missing = null;
let obj = {v: 7,
load() {
  return Promise.resolve(this.v);
}};
let bare = await fetchUser?.();
let none = await missing?.();
let args = await fetchUser?.(1);
let paren = await fetchUser?.(2);
let method = await obj.load?.();
let chain = (await fetchUser?.(3)).id;
let fallback = await missing?.() ?? "absent";
let list = [await missing?.(), await fetchUser?.(4)];
let text = `${await missing?.()}`;
let spread = {...await fetchUser?.(6), extra: 1};
let nothing = {...await missing?.(), kept: true};
let run = async function(cb) {
  return await cb?.(5);
};
let ran = run(function(n) {
  return Promise.resolve(n * 2);
});
let out = [bare, none, args, paren, method, chain, fallback, list, text, spread, nothing, ran];