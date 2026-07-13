// Compiler-only intrinsic operations. The Object constructor is reached
// through an object literal so inline delivery cannot resolve a source
// binding named Object, Reflect, or globalThis.
const {
  defineProperty: __definePropertyIntrinsic,
  getOwnPropertyNames: __getOwnPropertyNamesIntrinsic,
  getOwnPropertySymbols: __getOwnPropertySymbolsIntrinsic,
} = ({}).constructor;

const __toPropertyKey = (value) => {
  const holder = { [value]: 0 };
  const names = __getOwnPropertyNamesIntrinsic(holder);
  return names.length === 1 ? names[0] : __getOwnPropertySymbolsIntrinsic(holder)[0];
};

const __defineOwnDataProperty = (target, key, value) =>
  __definePropertyIntrinsic(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });

export { __toPropertyKey, __defineOwnDataProperty };
