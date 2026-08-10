// rip/fake — public face of the fake-data engine. The implementation
// lives in src/runtime/fake.js so Model.factory() (orm.js) and
// userland imports share one module instance (and one PRNG seed).
export { fake } from '../../src/runtime/fake.js';
export { fake as default } from '../../src/runtime/fake.js';
