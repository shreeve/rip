// Root pins for the compiler-emitted untyped-param class (render factory
// ctx/loops, schema transform `it`, event-handler `e`): the face must
// carry the missing type, and a garbage member through that parameter
// must raise TS2339 — greening TS7006 alone with `: any` is not enough.
import { describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { compile } from '../../src/compile.js';
import { stripFace } from '../../src/emitter.js';

const tscBin = () => {
  const p = join(import.meta.dir, '../../node_modules/typescript/bin/tsc');
  return existsSync(p) ? p : null;
};

const checkFace = (src) => {
  const faced = compile(src, { runtimeDelivery: 'none', face: 'ts' });
  const plain = compile(src, { runtimeDelivery: 'none', face: 'js' });
  expect(stripFace(faced.code, faced.tsRegions)).toBe(plain.code);
  const bin = tscBin();
  if (!bin) throw new Error('typescript/bin/tsc missing — required for untyped-params pins');
  const dir = mkdtempSync(join(tmpdir(), 'rip-untyped-'));
  writeFileSync(join(dir, 't.ts'), faced.code);
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      strict: true, noImplicitAny: true, target: 'ES2022', module: 'ESNext',
      lib: ['ES2022', 'DOM'], skipLibCheck: true, noEmit: true,
    },
  }));
  const r = spawnSync(process.execPath, [bin, '-p', dir, '--pretty', 'false'], { encoding: 'utf8' });
  return { code: faced.code, out: `${r.stdout || ''}${r.stderr || ''}` };
};

const codes = (out) => [...out.matchAll(/error TS(\d+)/g)].map((m) => m[1]);

describe('factory ctx / loop params (render fragment face)', () => {
  test('ctx: this + loop element type; bad member through ctx is TS2339', () => {
    const { code, out } = checkFace(`
export C = component
  count := 0
  @options?: string[] := []
  render
    if count
      = count.toUpperCase()
    for opt in options
      = opt.toUpperCase()
`);
    expect(code).toMatch(/create_block_\d+\(ctx: this/);
    expect(code).toContain('type __Self = typeof ctx');
    expect(code).toMatch(/opt: NonNullable<typeof ctx\.options\.value>\[number\]/);
    expect(code).toMatch(/i: number/);
    expect(codes(out)).toContain('2339');
    expect(out).toMatch(/toUpperCase/);
    expect(out).not.toMatch(/Parameter 'ctx' implicitly/);
    expect(out).not.toMatch(/Parameter 'opt' implicitly/);
  });
});

describe('schema transform it: NameRaw', () => {
  test('remaps stay clean; nonsenseMethod is TS2339; no TS7006 on it', () => {
    const clean = checkFace(`
QBCustomer = schema
  id! -> it.Id
  displayName! -> it.DisplayName
`);
    expect(clean.code).toContain('type QBCustomerRaw =');
    expect(clean.code).toContain('transform: (function(it: QBCustomerRaw)');
    expect(clean.out).not.toMatch(/Parameter 'it' implicitly/);
    expect(clean.out).not.toMatch(/Property 'Id' does not exist/);

    const bad = checkFace(`
QBCustomer = schema
  id! -> it.Id.toUpperCase().nonsenseMethod()
  displayName! -> it.DisplayName
`);
    expect(codes(bad.out)).toContain('2339');
    expect(bad.out).toMatch(/nonsenseMethod/);
  });
});

describe('event handler HTMLElementEventMap', () => {
  test('named + inline params typed; bad member is TS2339; strip holds', () => {
    const { code, out } = checkFace(`
export C = component
  handleClick: (e) -> e.totallyNotAnEventProperty
  render
    button @click: @handleClick
    button @click: (e) -> e.alsoFake
`);
    expect(code).toContain("handleClick(e: HTMLElementEventMap['click'])");
    expect(code).toContain("e: HTMLElementEventMap['click']");
    expect(code).toMatch(/addEventListener\('click', \(e/);
    expect(codes(out)).toContain('2339');
    expect(out).toMatch(/totallyNotAnEventProperty|alsoFake/);
    expect(out).not.toMatch(/Parameter 'e' implicitly/);
  });
});
