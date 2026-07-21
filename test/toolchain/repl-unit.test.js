// REPL internals, unit level: the persistence wrapper (generated only
// from reported binding names, scaffold names minted against the
// inventory), theme resolution, the live-highlight colorizer (never
// throws into the render path), history encoding, import-specifier
// splicing, and the in-process Session (plain bindings only — reactive
// flows run in subprocesses in repl.test.js, per the one-runtime-per-
// process rule).
import { describe, test, expect } from 'bun:test';
import { PassThrough } from 'node:stream';
import { mkdtempSync, writeFileSync, rmSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  mintFresh, buildWrapper, resolveThemeName, buildTheme, ansiFor,
  colorizeLastLine, stripAnsi, encodeEntry, decodeEntry, displayWidth,
  makeImportResolver, describeError, Session, Repl, THEME_NAMES,
} from '../../src/repl.js';
import { identifierRuns } from '../../src/lexer.js';
import { CompileError } from '../../src/compile.js';

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

  test('the emission-minted import resolver binds from the context object', () => {
    const { body } = buildWrapper({
      code: `await import(__resolveImport('./m.js'));`,
      source: `import './m.js'`,
      replImportResolver: '__resolveImport',
    });
    expect(body).toContain('const __resolveImport = __rip.resolveImport;');
    const without = buildWrapper({ code: '1;', source: '1' });
    expect(without.body).not.toContain('resolveImport');
  });

  test('mintFresh walks underscore suffixes', () => {
    const used = new Set(['x', 'x_']);
    expect(mintFresh('x', used)).toBe('x__');
    expect(used.has('x__')).toBe(true);
  });

  test('the identifier vocabulary is the LEXER\'s — Unicode names collect', () => {
    expect(identifierRuns('café := №1 + x')).toEqual(expect.arrayContaining(['café', 'x']));
    expect(identifierRuns('1 + 2')).toEqual([]);
    const { body } = buildWrapper({
      code: `café.value = 2;`,
      source: 'café = 2',
      priorKinds: new Map([['café', 'state']]),
    });
    expect(body).toContain(`const café = __rip.vars['café'];`);
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
    expect(encodeEntry('if x\n  1')).toBe('if x⏎n  1');
    expect(encodeEntry('plain')).toBe('plain');
  });

  test('the encoding is INJECTIVE: a literal ⏎ round-trips distinctly from a newline', () => {
    for (const entry of ['if x\n  1', 's = "a⏎b"', 'a⏎nb', 'a⏎eb', '⏎\n⏎']) {
      expect(decodeEntry(encodeEntry(entry))).toBe(entry);
      expect(encodeEntry(entry).includes('\n')).toBe(false);
    }
    expect(encodeEntry('a\nb')).not.toBe(encodeEntry('a⏎b'));
  });

  test('loadHistory decodes stored entries exactly (multi-line AND literal-⏎ single lines)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'rip-repl-hist-'));
    try {
      const file = join(tmp, 'history');
      const multi = 'if x\n  1';
      const glyph = 's = "a⏎b"';
      writeFileSync(file, `${encodeEntry(multi)}\n${encodeEntry(glyph)}\n`);
      const input = new PassThrough();
      const output = new PassThrough();
      const repl = new Repl({ input, output, env: { NO_COLOR: '1' } });
      repl.historyFile = file;
      repl.loadHistory();
      expect(repl.decodeTable.get(encodeEntry(multi))).toBe(multi);
      expect(repl.decodeTable.get(encodeEntry(glyph))).toBe(glyph);
      expect(repl.recall).toEqual([encodeEntry(glyph), encodeEntry(multi)]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('history persistence and recall bookkeeping', () => {
  const makeRepl = () => {
    const input = new PassThrough();
    const output = new PassThrough();
    return new Repl({ input, output, env: { NO_COLOR: '1' } });
  };

  test('the history file writes mode 0600 and TIGHTENS an existing looser file', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'rip-repl-mode-'));
    try {
      const file = join(tmp, 'history');
      writeFileSync(file, 'old\n', { mode: 0o644 });
      const repl = makeRepl();
      repl.historyFile = file;
      repl.entries.push('q = 1');
      repl.saveHistory();
      expect(statSync(file).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('recall bookkeeping REBUILDS rl.history from the session record — no splice guesses', () => {
    const repl = makeRepl();
    repl.rl = { history: [] };
    repl.noteRecall('a = 1');
    repl.noteRecall('if x\n  1');
    repl.noteRecall('.vars');
    repl.noteRecall('a = 1'); // repeat: dedups, newest first
    expect(repl.rl.history).toEqual(['a = 1', '.vars', encodeEntry('if x\n  1')]);
    expect(repl.decodeTable.get(encodeEntry('if x\n  1'))).toBe('if x\n  1');
  });
});

describe('repaint cursor math', () => {
  test('double-width characters count two cells; ANSI escapes count zero', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('你好')).toBe(4);
    expect(displayWidth('\x1b[32mab\x1b[0m')).toBe(2);
  });
});

describe('the cwd-anchored import resolver', () => {
  test('relative specifiers resolve against the session cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rip-repl-imp-'));
    try {
      writeFileSync(join(dir, 'm.rip'), 'export answer = 1\n');
      const resolve = makeImportResolver(dir);
      // Compare realpaths on both sides — the macOS tmpdir is a
      // symlink and resolveSync does not promise either spelling.
      expect(realpathSync(resolve('./m.rip'))).toBe(join(realpathSync(dir), 'm.rip'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('builtins, URLs, absolute paths, and non-strings pass through', () => {
    const resolve = makeImportResolver(tmpdir());
    expect(resolve('node:fs')).toBe('node:fs');
    expect(resolve('bun:test')).toBe('bun:test');
    expect(resolve('https://x.example/m.js')).toBe('https://x.example/m.js');
    expect(resolve('/abs/path.js')).toBe('/abs/path.js');
    expect(resolve(42)).toBe(42);
  });

  test('an unresolvable specifier throws naming the specifier and the base', () => {
    const resolve = makeImportResolver('/tmp');
    expect(() => resolve('no-such-pkg-xyz')).toThrow(/Cannot resolve import 'no-such-pkg-xyz' from '\/tmp'/);
  });
});

describe('error display', () => {
  test('CompileError keeps its positioned message; Errors show name and message', () => {
    const ce = new CompileError('<repl>:1:1: boom');
    expect(describeError(ce)).toBe('<repl>:1:1: boom');
    expect(describeError(new TypeError('nope'))).toBe('TypeError: nope');
  });

  test('a ResolveMessage-shaped non-Error surfaces message, specifier, and referrer — never {}', () => {
    const rm = { name: 'ResolveMessage', message: 'Cannot find module', specifier: './x.js', referrer: '/tmp/repl.js' };
    expect(describeError(rm)).toBe("ResolveMessage: Cannot find module (importing './x.js' from '/tmp/repl.js')");
    expect(describeError({ message: 'bare' })).toBe('Error: bare');
    expect(describeError('thrown string')).toBe("'thrown string'");
  });
});

describe('in-process session (plain bindings only)', () => {
  test('bindings persist; assignments echo their value and reads capture', async () => {
    const s = new Session();
    const w = await s.eval('q = 41');
    expect(w.captured).toBe(true);
    expect(w.value).toBe(41);
    const r = await s.eval('q + 1');
    expect(r.captured).toBe(true);
    expect(r.value).toBe(42);
    expect(s.bindings.get('q')).toBe('plain');
  });

  test('a destructuring assignment echoes the full RHS value', async () => {
    const s = new Session();
    expect((await s.eval('[a, b] = [1, 2]')).value).toEqual([1, 2]);
    expect((await s.eval('b')).value).toBe(2);
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
