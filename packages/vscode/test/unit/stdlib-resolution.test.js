// Which checkout's stdlib a `rip/<pkg>` specifier lands in.
//
// The stdlib is local-first, the rule the runtime loader applies: a
// workspace inside a rip checkout is checked against THAT checkout's
// stdlib, so the same source answers the same under any binary. A
// workspace enclosed by no checkout — every consumer app — gets the
// stdlib the running binary carries.
//
// One value serves the whole process. The resolver and the generated
// tsconfig's `paths` map must name the same directory: a map pointing at
// faces the closure never materializes squiggles TS2307 on every `rip/*`
// import, so these pin that the two agree.
import { test, expect, afterEach, afterAll } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ripSpecifierTarget, isStdlibPath, stdlibRipPaths, anchorStdlib } from '../../src/mirror.js';

const REAL_ROOT = fs.realpathSync(path.resolve(import.meta.dir, '..', '..', '..', '..'));
const BINARY_VALIDATE = path.join(REAL_ROOT, 'packages', 'validate', 'validate.rip');

const made = [];
afterAll(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });
afterEach(() => anchorStdlib(null));

function tmp(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  return dir;
}

// A rip checkout is known by rip's OWN editor package; `validate` doubles
// the real stdlib's name so the fixture's copy has something to win
// against.
function makeCheckout(names = ['validate']) {
  const root = tmp('rip-checkout-');
  fs.mkdirSync(path.join(root, 'packages', 'vscode'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages', 'vscode', 'package.json'), JSON.stringify({ name: 'vscode-rip' }));
  for (const name of names) {
    const dir = path.join(root, 'packages', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `@rip/${name}`, exports: { '.': `./${name}.rip` } }));
    fs.writeFileSync(path.join(dir, `${name}.rip`), 'export marker = 1\n');
  }
  return root;
}

test("a checkout's own copy of a name wins over the running binary's", () => {
  const root = makeCheckout();
  anchorStdlib(root);
  expect(ripSpecifierTarget('rip/validate', path.join(root, 'packages', 'validate')))
    .toBe(path.join(root, 'packages', 'validate', 'validate.rip'));
});

test('a name only the anchored checkout carries resolves inside it', () => {
  const root = makeCheckout(['faux']);
  anchorStdlib(root);
  expect(ripSpecifierTarget('rip/faux', root)).toBe(path.join(root, 'packages', 'faux', 'faux.rip'));
});

test('anchoring below the checkout root still finds it', () => {
  const root = makeCheckout();
  anchorStdlib(path.join(root, 'packages', 'validate'));
  expect(ripSpecifierTarget('rip/validate', root)).toBe(path.join(root, 'packages', 'validate', 'validate.rip'));
});

test('two checkouts of the same name each answer with their own copy', () => {
  const a = makeCheckout();
  const b = makeCheckout();
  anchorStdlib(a);
  expect(ripSpecifierTarget('rip/validate', a)).toBe(path.join(a, 'packages', 'validate', 'validate.rip'));
  anchorStdlib(b);
  expect(ripSpecifierTarget('rip/validate', b)).toBe(path.join(b, 'packages', 'validate', 'validate.rip'));
});

test("a consumer app outside any checkout gets the running binary's stdlib", () => {
  const outside = tmp('rip-consumer-');
  anchorStdlib(outside);
  expect(ripSpecifierTarget('rip/validate', outside)).toBe(BINARY_VALIDATE);
});

// A monorepo shipping its own VS Code extension has `packages/vscode/`
// too. It is not a rip checkout, and serving it its own `packages` as the
// stdlib would strand every `rip/*` name it imports.
test('a monorepo with its own packages/vscode is not a rip checkout', () => {
  const root = tmp('rip-lookalike-');
  fs.mkdirSync(path.join(root, 'packages', 'vscode'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages', 'vscode', 'package.json'), JSON.stringify({ name: '@acme/vscode' }));
  fs.mkdirSync(path.join(root, 'packages', 'web'), { recursive: true });
  anchorStdlib(root);
  expect(ripSpecifierTarget('rip/validate', path.join(root, 'packages', 'web'))).toBe(BINARY_VALIDATE);
  expect(isStdlibPath(path.join(root, 'packages', 'web', 'app.rip'))).toBe(false);
});

// The tsconfig `paths` map and the resolver are read off one directory:
// a workspace holding a checkout it is not itself part of must not get
// one tree's faces mapped against the other's.
test('the tsconfig map and the resolver name the same stdlib', () => {
  const ws = tmp('rip-ws-above-');
  const inner = makeCheckout();
  fs.cpSync(inner, path.join(ws, 'rip'), { recursive: true });
  anchorStdlib(ws);
  const target = ripSpecifierTarget('rip/validate', path.join(ws, 'rip', 'packages', 'validate'));
  const mapped = stdlibRipPaths(ws)['rip/validate'];
  expect(target).toBe(BINARY_VALIDATE);
  expect(mapped?.[0]).toContain(path.join(REAL_ROOT, 'packages', 'validate', 'validate.rip'));
});

test('the workspace fence admits the anchored stdlib and nothing else', () => {
  const other = makeCheckout();
  anchorStdlib(null);
  expect(isStdlibPath(BINARY_VALIDATE)).toBe(true);
  expect(isStdlibPath(path.join(other, 'packages', 'validate', 'validate.rip'))).toBe(false);
});
