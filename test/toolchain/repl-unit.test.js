// REPL internals, unit level: the persistence wrapper (generated only
// from reported binding names, scaffold names minted against the
// inventory), theme resolution, the live-highlight colorizer (never
// throws into the render path), history encoding, import-specifier
// splicing, and the in-process Session (plain bindings only — reactive
// flows run in subprocesses in repl.test.js, per the one-runtime-per-
// process rule).
import { describe, test, expect } from 'bun:test';
import { PassThrough } from 'node:stream';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  mintFresh, buildWrapper, resolveThemeName, buildTheme, ansiFor,
  colorizeLastLine, stripAnsi, encodeEntry, resolveImportSpecs,
  Session, Repl, THEME_NAMES,
} from '../../src/repl.js';
import { compile } from '../../src/compile.js';

describe('wrapper generation', () => {
  test('strict prologue, block-nested user code, restore and save from reported names', () => {
    const priorKinds = new Map([['a', 'plain'], ['x', 'state'], ['k', 'readonly']]);
    const { body, ctxName } = buildWrapper({
      code: 'a = a + 1;',
      source: 'a = a + 1',
      priorKinds,
      lineBindings: [],
      rtNames: [],
    });
    expect(ctxName).toBe('__rip');
    expect(body).toStartWith(`'use strict';`);
    expect(body).toContain(`let a = __rip.vars['a'];`);
    expect(body).toContain(`const x = __rip.vars['x'];`);
    expect(body).toContain(`const k = __rip.vars['k'];`);
    expect(body).toContain('{\na = a + 1;');
    expect(body).toContain(`__rip.vars['a'] = a;`);
    expect(body).toContain(`__rip.vars['x'] = x;`);
  });

  test('the result slot rides only when the emission captured one', () => {
    const withCapture = buildWrapper({ code: 'const __result = 1;', source: '1', replResultName: '__result' });
    expect(withCapture.body).toContain('__last = __result;');
    expect(withCapture.body).toContain('return __last;');
    const without = buildWrapper({ code: 'let x = 1;', source: 'x = 1', lineBindings: [{ name: 'x', kind: 'plain' }] });
    expect(without.body).not.toContain('= __result');
    expect(without.body).toContain(`__rip.vars['x'] = x;`);
  });

  test('scaffold names dodge user identifiers (never fixed strings)', () => {
    const { body, ctxName } = buildWrapper({
      code: 'let __rip = 1;\nconst __result = __last + __rip;',
      source: '__rip = 1\n__last + __rip',
      replResultName: '__result',
      priorKinds: new Map([['__last', 'plain']]),
      lineBindings: [{ name: '__rip', kind: 'plain' }],
    });
    expect(ctxName).toBe('__rip_');
    expect(body).toContain('let __last_;');
    expect(body).toContain('__last_ = __result;');
    expect(body).toContain('return __last_;');
  });

  test('_ restores as the last-result binding and never saves', () => {
    const { body } = buildWrapper({
      code: '1;',
      source: '1',
      priorKinds: new Map([['_', 'plain'], ['a', 'plain']]),
    });
    expect(body).toContain(`let _ = __rip.vars['_'];`);
    expect(body).not.toContain(`__rip.vars['_'] = _;`);
    expect(body).toContain(`__rip.vars['a'] = a;`);
  });

  test('loaded runtime names expose from the context object, minus shadowed ones', () => {
    const { body } = buildWrapper({
      code: '1;',
      source: '1',
      priorKinds: new Map([['p', 'plain']]),
      rtNames: ['p', 'sleep', 'zip'],
    });
    expect(body).toContain('const { sleep, zip } = __rip.rt;');
    expect(body).toContain(`let p = __rip.vars['p'];`);
  });

  test('mintFresh walks underscore suffixes', () => {
    const used = new Set(['x', 'x_']);
    expect(mintFresh('x', used)).toBe('x__');
    expect(used.has('x__')).toBe(true);
  });
});

describe('theme resolution', () => {
  test('NO_COLOR and non-TTY force mono over every other choice', () => {
    expect(resolveThemeName({ override: 'dark', noColor: true, tty: true })).toBe('mono');
    expect(resolveThemeName({ override: 'dark', noColor: false, tty: false })).toBe('mono');
  });

  test('precedence: session override, then config, then detected, then dark', () => {
    expect(resolveThemeName({ override: 'light', configTheme: 'dark', detected: 'dark' })).toBe('light');
    expect(resolveThemeName({ configTheme: 'light', detected: 'dark' })).toBe('light');
    expect(resolveThemeName({ detected: 'light' })).toBe('light');
    expect(resolveThemeName({})).toBe('dark');
    expect(resolveThemeName({ override: 'bogus' })).toBe('dark');
  });

  test('mono paints plain; dark paints', () => {
    const mono = buildTheme('mono');
    expect(mono.paint('keyword', 'if')).toBe('if');
    const dark = buildTheme('dark');
    expect(dark.paint('keyword', 'if')).toContain('\x1b[');
    expect(stripAnsi(dark.paint('keyword', 'if'))).toBe('if');
  });

  test('config color overrides: named ANSI and hex, downconverted by COLORTERM', () => {
    expect(ansiFor('green')).toBe('\x1b[32m');
    expect(ansiFor('#ff0000', 'truecolor')).toBe('\x1b[38;2;255;0;0m');
    expect(ansiFor('#ff0000', '')).toBe('\x1b[38;5;196m');
    expect(ansiFor('not-a-color')).toBe('');
    const themed = buildTheme('dark', { string: '#00ff00' }, 'truecolor');
    expect(themed.codes.string).toBe('\x1b[38;2;0;255;0m');
  });

  test('the theme name list is the .theme command surface', () => {
    expect(THEME_NAMES).toEqual(['dark', 'light', 'mono']);
  });
});

describe('live-highlight colorizer', () => {
  const dark = buildTheme('dark');

  test('keywords, numbers, and strings paint; bytes strip back to the raw line', () => {
    const out = colorizeLastLine('if x then 1 else "s"', dark);
    expect(stripAnsi(out)).toBe('if x then 1 else "s"');
    expect(out).toContain(dark.codes.keyword + 'if' + '\x1b[0m');
    expect(out).toContain(dark.codes.number + '1' + '\x1b[0m');
    expect(out).toContain(dark.codes.string + '"s"' + '\x1b[0m');
  });

  test('an OPEN string mid-typing still colors (the repair path)', () => {
    const out = colorizeLastLine('x = "abc', dark);
    expect(out).not.toBeNull();
    expect(stripAnsi(out)).toBe('x = "abc');
    expect(out).toContain(dark.codes.string);
  });

  test('an open bracket and an open heredoc color too', () => {
    expect(stripAnsi(colorizeLastLine('f(1,', dark))).toBe('f(1,');
    expect(stripAnsi(colorizeLastLine('"""\nabc', dark))).toBe('abc');
  });

  test('only the LAST line of a multi-line buffer renders', () => {
    const out = colorizeLastLine('x := 5\nif x', dark);
    expect(stripAnsi(out)).toBe('if x');
  });

  test('a hard lexer error returns null instead of throwing', () => {
    expect(colorizeLastLine('x = "a\nb', dark)).toBe(null);
  });

  test('comments paint from the trivia channel', () => {
    const out = colorizeLastLine('1 # note', dark);
    expect(out).toContain(dark.codes.comment + '# note' + '\x1b[0m');
  });

  test('mono renders bytes-identical to the raw line', () => {
    const mono = buildTheme('mono');
    expect(colorizeLastLine('if x then 1 else "s"', mono)).toBe('if x then 1 else "s"');
  });
});

describe('history encoding', () => {
  test('multi-line entries encode to one line', () => {
    expect(encodeEntry('if x\n  1')).toBe('if x⏎  1');
    expect(encodeEntry('plain')).toBe('plain');
  });
});

describe('import specifier splicing', () => {
  test('relative specifiers resolve against the cwd by recorded spans', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-repl-imp-'));
    try {
      writeFileSync(join(dir, 'm.rip'), 'export answer = 1\n');
      const r = compile('import { answer } from "./m.rip"', { repl: true, runtimeDelivery: 'none' });
      const out = resolveImportSpecs(r.code, r.imports, dir);
      expect(out).toContain(join(dir, 'm.rip'));
      expect(out).not.toContain("'./m.rip'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('builtins and unresolvable specifiers stay as written', () => {
    const r = compile('import { readFileSync } from "node:fs"\nimport missing from "no-such-pkg-xyz"', { repl: true, runtimeDelivery: 'none' });
    const out = resolveImportSpecs(r.code, r.imports, tmpdir());
    expect(out).toContain("'node:fs'");
    expect(out).toContain("'no-such-pkg-xyz'");
  });
});

describe('in-process session (plain bindings only)', () => {
  test('bindings persist and reads capture', async () => {
    const s = new Session();
    expect((await s.eval('q = 41')).captured).toBe(false);
    const r = await s.eval('q + 1');
    expect(r.captured).toBe(true);
    expect(r.value).toBe(42);
    expect(s.bindings.get('q')).toBe('plain');
  });

  test('a user binding of the would-be result name never collides', async () => {
    const s = new Session();
    await s.eval('__result = 99');
    expect((await s.eval('1 + 1')).value).toBe(2);
    expect((await s.eval('__result')).value).toBe(99);
  });

  test('_ is the last captured result and survives a match-write entry', async () => {
    const s = new Session();
    await s.eval('7 * 6');
    expect((await s.eval('_')).value).toBe(42);
    const m = await s.eval('"ab" =~ /a(b)/');
    expect(m.value[1]).toBe('b');
    expect((await s.eval('_'))?.value[1]).toBe('b');
  });

  test('promise results flatten before display', async () => {
    const s = new Session();
    expect((await s.eval('Promise.resolve(7)')).value).toBe(7);
  });

  test('clear resets bindings and vars', async () => {
    const s = new Session();
    await s.eval('q = 1');
    s.clear();
    expect(s.bindings.size).toBe(0);
    expect(Object.keys(s.ctx.vars)).toEqual([]);
  });

  test('a failed evaluation never advances the binding inventory', async () => {
    const s = new Session();
    await expect(s.eval('boom = nope.deep.read')).rejects.toThrow();
    expect(s.bindings.has('boom')).toBe(false);
  });
});

describe('completion', () => {
  const makeRepl = () => {
    const input = new PassThrough();
    const output = new PassThrough();
    return new Repl({ input, output, env: { NO_COLOR: '1' } });
  };

  test('binding names complete; _ never offers', () => {
    const repl = makeRepl();
    repl.session.bindings.set('counter', 'state');
    repl.session.bindings.set('count', 'plain');
    repl.session.bindings.set('_', 'plain');
    const [hits, word] = repl.complete('1 + cou');
    expect(word).toBe('cou');
    expect(hits).toEqual(['count', 'counter']);
    expect(repl.complete('x')[0]).toEqual([]);
  });

  test('dot commands complete at the start of a line', () => {
    const repl = makeRepl();
    const [hits] = repl.complete('.he');
    expect(hits).toEqual(['.help']);
    const [all] = repl.complete('.');
    expect(all).toContain('.vars');
    expect(all).toContain('.editor');
  });
});
