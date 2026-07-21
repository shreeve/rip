// REPL acceptance: real sessions driven over piped stdin through
// `bin/rip -r` (readline works on pipes; the completer is inert with
// terminal:false; non-TTY forces the mono theme, so transcripts carry
// no ANSI). HOME points at a scratch directory so ~/.rip_history
// never touches the real one.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const BIN = resolve(import.meta.dir, '../../bin/rip');

let dir, home;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'rip-repl-'));
  home = mkdtempSync(join(tmpdir(), 'rip-repl-home-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

const repl = (input, { env = {}, args = ['-r'] } = {}) => {
  const r = spawnSync('bun', [BIN, ...args], {
    cwd: dir,
    input,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, TERM: 'xterm-256color', ...env },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
};

// The `→ value` result lines of a transcript, prompt noise stripped.
const results = (stdout) =>
  stdout.split('\n').flatMap((l) => {
    const at = l.indexOf('→ ');
    return at === -1 ? [] : [l.slice(at + 2)];
  });

describe('repl: cross-line reactive persistence', () => {
  test('x := 5, x + 1, x = 3, x — signal access carries across lines, every step echoes', () => {
    const r = repl('x := 5\nx + 1\nx = 3\nx\n');
    expect(r.status).toBe(0);
    expect(results(r.stdout)).toEqual(['5', '6', '3', '3']);
  });

  test('computed and readonly persist; cross-line writes reject positioned', () => {
    const r = repl('a := 2\nb ~= a * 10\nb\nb = 1\nk =! 7\nk = 9\n');
    expect(results(r.stdout)).toEqual(['2', '20', '20', '7']);
    expect(r.stdout).toContain("cannot assign to computed 'b'");
    expect(r.stdout).toContain("cannot assign to readonly 'k'");
    expect(r.status).toBe(0);
  });

  test('an effect fires on later-line writes; its dispose handle stops it', () => {
    const r = repl('a := 1\nh ~> p a\na = 2\nh()\na = 3\n');
    const printed = r.stdout.split('\n')
      .map((l) => l.replace(/^(rip> |\.\.\.\.> )+/, ''))
      .filter((l) => /^\d+$/.test(l));
    expect(printed).toEqual(['1', '2']);
    expect(r.status).toBe(0);
  });
});

describe('repl: _ and display', () => {
  test('_ holds the last printed result, including across a =~ match write', () => {
    const r = repl('7 * 6\n_\n"ab" =~ /a(b)/\n_\n');
    const rows = results(r.stdout);
    expect(rows[0]).toBe('42');
    expect(rows[1]).toBe('42');
    expect(rows[2]).toContain("'ab'");
    expect(rows[3]).toBe(rows[2]);
  });

  test('a declaration echo updates _', () => {
    const r = repl('x := 2 ** 10\n_\n');
    expect(results(r.stdout)).toEqual(['1024', '1024']);
  });

  test('Unicode identifiers round-trip across lines (the lexer vocabulary)', () => {
    const r = repl('café := 1\ncafé + 1\ncafé = 2\ncafé\n');
    expect(r.status).toBe(0);
    expect(results(r.stdout)).toEqual(['1', '2', '2', '2']);
  });

  test('undefined results print nothing — an undefined-initializing assignment included', () => {
    const r = repl('undefined\nconsole.log(1 + 2)\nq = undefined\n1\n');
    expect(results(r.stdout)).toEqual(['1']);
    expect(r.stdout).toContain('3');
    expect(r.stdout).not.toContain('undefined');
  });

  test('promise results flatten before display', () => {
    const r = repl('y = Promise.resolve(7)\ny\n');
    expect(results(r.stdout)).toEqual(['7', '7']);
  });

  test('declarations and assignments echo their bound value, containers unwrapped', () => {
    const r = repl('x := 2 ** 10\nq = 1\nd ~= x + q\nk =! 3\n[a, b] = [8, 9]\n');
    expect(results(r.stdout)).toEqual(['1024', '1', '1025', '3', '[ 8, 9 ]']);
  });
});

describe('repl: continuation and errors', () => {
  test('incomplete lines continue; the joined entry evaluates', () => {
    const r = repl('1 +\n2\n[1,\n2]\n');
    expect(r.stdout).toContain('....>');
    expect(results(r.stdout)).toEqual(['3', '[ 1, 2 ]']);
  });

  test('an indented line keeps a complete block open for else; empty line runs it', () => {
    const r = repl('z = if true\n  "yes"\nelse\n  "no"\n\nz\n');
    expect(results(r.stdout)).toEqual(["'yes'", "'yes'"]);
  });

  test('a hard error prints the positioned diagnostic and the session continues', () => {
    const r = repl('x = = 3\n1 + 1\n');
    expect(r.stdout).toContain("Unexpected '='");
    expect(r.stdout).toContain('<repl>:1:5');
    expect(results(r.stdout)).toEqual(['2']);
    expect(r.status).toBe(0);
  });

  test('a runtime error prints and the session continues', () => {
    const r = repl('nope.deep\n2\n');
    expect(r.stdout).toMatch(/ReferenceError|TypeError/);
    expect(results(r.stdout)).toEqual(['2']);
  });

  test('export rejects positioned and the session continues', () => {
    const r = repl('export q = 5\n1\n');
    expect(r.stdout).toContain("'export' has no meaning in a REPL entry");
    expect(r.stdout).toContain('<repl>:1:1');
    expect(results(r.stdout)).toEqual(['1']);
    expect(r.status).toBe(0);
  });
});

describe('repl: dot commands', () => {
  test('.vars lists bindings with kind indicators', () => {
    const r = repl('a := 1\nb ~= a * 2\nc =! 3\nd = 4\n.vars\n');
    expect(r.stdout).toContain('a := 1');
    expect(r.stdout).toContain('b ~= 2');
    expect(r.stdout).toContain('c =! 3');
    expect(r.stdout).toContain('d = 4');
  });

  test('.clear resets the session', () => {
    const r = repl('q = 1\n.clear\n.vars\nq\n');
    expect(r.stdout).toContain('Session cleared');
    expect(r.stdout).toContain('No bindings defined');
    expect(r.stdout).toContain('ReferenceError');
  });

  test('.js shows the compiled emission; .sexp the tree; .tokens the tape', () => {
    const r = repl('.js\n.sexp\n.tokens\n1 + 1\n');
    expect(r.stdout).toContain('const __result = 1 + 1;');
    expect(r.stdout).toContain('["program",["+","1","1"]]');
    expect(r.stdout).toContain('NUMBER "1"');
  });

  test('.help is honest: no Tab-history claim, documents _ and the =~ interplay', () => {
    const r = repl('.help\n');
    expect(r.stdout).toContain('.editor');
    expect(r.stdout).toContain('.theme');
    expect(r.stdout).toContain('match write');
    expect(r.stdout).not.toMatch(/Tab for history/);
  });

  test('.history recalls multi-line entries as single rows', () => {
    const r = repl('if true\n  1\n\n.history\n');
    expect(r.stdout).toContain('1: if true⏎n  1');
  });

  test('.theme reports and switches; unknown names reject', () => {
    const r = repl('.theme\n.theme bogus\n.theme light\n');
    expect(r.stdout).toContain('theme: mono');
    expect(r.stdout).toContain("unknown theme 'bogus'");
    // Non-TTY still forces mono over the override — no ANSI leaks.
    expect(r.stdout).not.toContain('\x1b[');
  });

  test('.editor composes multiple lines and end-of-input runs them', () => {
    const r = repl('.editor\na = 10\nb = 20\na * b\n');
    expect(r.stdout).toContain('editor mode');
    expect(results(r.stdout)).toEqual(['200']);
  });
});

describe('repl: imports', () => {
  test('a .rip import resolves against the scratch cwd through the loader', () => {
    writeFileSync(join(dir, 'mod.rip'), 'export answer = 42\nexport def triple(n)\n  n * 3\n');
    const r = repl('import { answer, triple } from "./mod.rip"\ntriple(answer)\n');
    expect(results(r.stdout)).toEqual(['126']);
    expect(r.status).toBe(0);
  });

  test('import bindings persist to later lines', () => {
    writeFileSync(join(dir, 'mod2.rip'), 'export base = 10\n');
    const r = repl('import { base } from "./mod2.rip"\nbase + 1\nbase + 2\n');
    expect(results(r.stdout)).toEqual(['11', '12']);
  });

  test('a user-spelled dynamic .rip import resolves against the scratch cwd', () => {
    writeFileSync(join(dir, 'mod3.rip'), 'export answer = 42\n');
    const r = repl('m = await import("./mod3.rip")\nm.answer\n');
    expect(results(r.stdout)).toContain('42');
    expect(r.status).toBe(0);
  });

  test('a COMPUTED dynamic-import specifier resolves against the cwd too', () => {
    writeFileSync(join(dir, 'mod4.rip'), 'export def double(n)\n  n * 2\n');
    const r = repl('spec = "./mod" + "4.rip"\nn = await import(spec)\nn.double(21)\n');
    expect(results(r.stdout)).toContain('42');
  });

  test('an unresolvable specifier fails loudly, naming the specifier and the base', () => {
    const r = repl('await import("no-such-pkg-xyz")\n1\n');
    expect(r.stdout).toContain("Cannot resolve import 'no-such-pkg-xyz'");
    expect(r.stdout).toContain(dir.split('/').pop());
    expect(r.stdout).not.toContain('ResolveMessage {}');
    expect(results(r.stdout)).toEqual(['1']);
  });
});

describe('repl: colors and environment', () => {
  test('NO_COLOR forces mono — zero ANSI bytes in the transcript', () => {
    const r = repl('x := 5\nx\n.vars\n', { env: { NO_COLOR: '1' } });
    expect(r.stdout).not.toContain('\x1b[');
    expect(results(r.stdout)).toEqual(['5', '5']);
  });

  test('non-TTY forces mono even without NO_COLOR', () => {
    const r = repl('1\n');
    expect(r.stdout).not.toContain('\x1b[');
  });

  test('history persists to $HOME/.rip_history with multi-line entries encoded', () => {
    const scratchHome = mkdtempSync(join(tmpdir(), 'rip-repl-h-'));
    try {
      repl('q = 1\nif true\n  2\n\n', { env: { HOME: scratchHome } });
      const file = join(scratchHome, '.rip_history');
      expect(existsSync(file)).toBe(true);
      const lines = readFileSync(file, 'utf8').trim().split('\n');
      expect(lines).toContain('q = 1');
      expect(lines).toContain('if true⏎n  2');
      // A second session dedups repeats.
      repl('q = 1\n', { env: { HOME: scratchHome } });
      const again = readFileSync(file, 'utf8').trim().split('\n');
      expect(again.filter((l) => l === 'q = 1').length).toBe(1);
    } finally {
      rmSync(scratchHome, { recursive: true, force: true });
    }
  });
});

describe('repl: -e/--eval', () => {
  test('-e evaluates one entry and prints its value', () => {
    const r = repl(undefined, { args: ['-e', '2 ** 10'] });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('1024\n');
  });

  test('-e echoes assignments; undefined-valued entries print nothing', () => {
    const echo = repl(undefined, { args: ['-e', 'x = 5'] });
    expect(echo.status).toBe(0);
    expect(echo.stdout).toBe('5\n');
    const silent = repl(undefined, { args: ['-e', 'q = undefined'] });
    expect(silent.status).toBe(0);
    expect(silent.stdout).toBe('');
  });

  test('-e rejects incomplete input and compile errors non-zero', () => {
    const incomplete = repl(undefined, { args: ['-e', 'x :='] });
    expect(incomplete.status).toBe(1);
    expect(incomplete.stderr).toContain('incomplete');
    const broken = repl(undefined, { args: ['-e', 'x = = 3'] });
    expect(broken.status).toBe(1);
    expect(broken.stderr).toContain("Unexpected '='");
  });

  test('-e cannot combine with compile options', () => {
    const r = repl(undefined, { args: ['-e', '1', '-c'] });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('cannot combine');
  });
});
