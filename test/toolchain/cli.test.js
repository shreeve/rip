// CLI/loader: the `rip` executable and the Bun .rip loader plugin,
// end-to-end. Fixtures are real files in temp directories; run-mode tests
// spawn the CLI and assert stdout/stderr/exit status — the loader, the
// module linker, and the inline source maps are all exercised for real.
// Diagnostics tests pin exact file:line:col positions (offsets convert
// via lineStarts only at this boundary).
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { compile, CompileError } from '../../src/compile.js';
import { decodeMappings } from '../../src/sourcemap.js';
import { registerModuleMap, remapStack } from '../../src/stackmap.js';

const BIN = resolve(import.meta.dir, '../../bin/rip');

let dir;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'rip-cli-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const write = (name, text) => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};

const rip = (args, { input } = {}) => {
  const r = spawnSync('bun', [BIN, ...args], { cwd: dir, input, encoding: 'utf8' });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
};

describe('cli: compile surface', () => {
  const source = 'def bump(x)\n  x + 1\n\nconsole.log bump(41)\n';

  test('-c prints the pipeline output', () => {
    write('bump.rip', source);
    const r = rip(['-c', 'bump.rip']);
    expect(r.status).toBe(0);
    const { code } = compile(source, { path: 'bump.rip' });
    expect(r.stdout).toBe(`${code}\n`);
  });

  test('-c reads stdin when no file is given', () => {
    const r = rip(['-c'], { input: 'x = 1\n' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('x = 1;');
  });

  test('-o writes the file and prints nothing', () => {
    write('bump.rip', source);
    const r = rip(['-o', 'bump.js', 'bump.rip']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    const { code } = compile(source, { path: 'bump.rip' });
    expect(readFileSync(join(dir, 'bump.js'), 'utf8')).toBe(`${code}\n`);
  });

  test('-m appends an inline source map that decodes and points home', () => {
    const src = 'x = 1\ny = x + 2\n';
    write('mapped.rip', src);
    const r = rip(['-cm', 'mapped.rip']);
    expect(r.status).toBe(0);

    const m = r.stdout.match(/\/\/# sourceMappingURL=data:application\/json;charset=utf-8;base64,(\S+)\n$/);
    expect(m).not.toBeNull();
    const map = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
    expect(map.version).toBe(3);
    expect(map.sources).toEqual(['mapped.rip']);
    expect(map.sourcesContent).toEqual([src]);

    // `y = x + 2` is source line 1; its generated line must carry a
    // segment mapping back to it.
    const code = r.stdout.slice(0, r.stdout.indexOf('//# sourceMappingURL'));
    const genLine = code.split('\n').findIndex((l) => l.startsWith('let y = ')); // Tier 1 declare-in-place
    expect(genLine).toBeGreaterThan(-1);
    const segments = decodeMappings(map.mappings);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.some((s) => s.genLine === genLine && s.srcLine === 1 && s.srcCol === 0)).toBe(true);
  });

  test('-t prints the token stream with spans', () => {
    write('bump.rip', source);
    const r = rip(['-t', 'bump.rip']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[0,3) DEF "def"');
    expect(r.stdout).toContain('[4,8) IDENTIFIER "bump"');
  });

  test('-s prints the s-expression tree', () => {
    write('bump.rip', source);
    const r = rip(['-s', 'bump.rip']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)[0]).toBe('program');
    expect(r.stdout).toContain('"def","bump"');
  });

  test('--version and --help exit 0', () => {
    expect(rip(['--version']).status).toBe(0);
    const h = rip(['--help']);
    expect(h.status).toBe(0);
    expect(h.stdout).toContain('Usage:');
  });
});

describe('cli: feature-runtime delivery (--runtime)', () => {
  // A hand-written runtime reference (no reactive syntax needed —
  // the delivery rule: reference a delivered name, get the runtime).
  const reactive = 'n = __state(1)\nconsole.log n.value\n';

  test('-c defaults to inline: the prelude is present and the output runs standalone', () => {
    write('rtinline.rip', reactive);
    const r = rip(['-c', 'rtinline.rip']);
    expect(r.status).toBe(0);
    // The inline prelude: the runtime body in an IIFE binding the
    // delivered names, once, at the top of the output.
    expect(r.stdout).toContain('const { __state,');
    expect(r.stdout).toContain('} = (() => {');
    // Self-contained proof: the compiled file runs under bare bun —
    // no loader, no preload, no import to resolve.
    writeFileSync(join(dir, 'rtinline.js'), r.stdout);
    const run = spawnSync('bun', [join(dir, 'rtinline.js')], { cwd: dir, encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe('1\n');
  });

  test('--runtime import emits one import of the shared runtime module', () => {
    write('rtimport.rip', reactive);
    const r = rip(['-c', '--runtime', 'import', 'rtimport.rip']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^import \{ __state,.*\} from ".*src\/runtime\/reactive\.js";\n/);
    expect(r.stdout).not.toContain('(() => {');
  });

  test('--runtime bogus exits 2 with the usage message', () => {
    write('rtbogus.rip', reactive);
    const r = rip(['-c', '--runtime', 'bogus', 'rtbogus.rip']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--runtime takes 'inline' or 'import' (got 'bogus')");
  });
});

describe('cli: declaration delivery (--dts / --dts-dir)', () => {
  const typed = 'x: number = 5\ndef area(w: number, h: number): number\n  w * h\n';
  const DECLS = 'declare let x: number;\ndeclare function area(w: number, h: number): number;\nexport {};\n';

  test('--dts alone prints the declarations to stdout — and nothing else', () => {
    write('typed.rip', typed);
    const r = rip(['--dts', 'typed.rip']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(DECLS);
  });

  test('--dts reads stdin in stdout mode', () => {
    const r = rip(['--dts'], { input: 'n: number = 1\n' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('declare let n: number;\nexport {};\n');
  });

  test('placement follows the output: -o dist/app.js writes dist/app.d.ts beside it', () => {
    write('typed.rip', typed);
    mkdirSync(join(dir, 'dist'), { recursive: true });
    const r = rip(['-o', 'dist/app.js', '--dts', 'typed.rip']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(readFileSync(join(dir, 'dist/app.js'), 'utf8')).toContain('function area');
    expect(readFileSync(join(dir, 'dist/app.d.ts'), 'utf8')).toBe(DECLS);
  });

  test('--dts-dir re-roots the source path under the directory (implies --dts)', () => {
    const sub = join(dir, 'src/deep');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'mod.rip'), typed);
    const r = rip(['--dts-dir', 'types', 'src/deep/mod.rip']);
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, 'types/src/deep/mod.d.ts'), 'utf8')).toBe(DECLS);
  });

  test('an untyped file yields the trivial declaration — the JS is untouched', () => {
    write('plain.rip', 'y = 1\n');
    const plainJs = rip(['-c', 'plain.rip']).stdout;
    const r = rip(['-o', 'plain.js', '--dts', 'plain.rip']);
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, 'plain.d.ts'), 'utf8')).toBe('');
    expect(readFileSync(join(dir, 'plain.js'), 'utf8')).toBe(plainJs);
    // Without --dts no declaration output exists anywhere: same
    // compile, no .d.ts.
    rmSync(join(dir, 'plain.d.ts'));
    rip(['-o', 'plain.js', 'plain.rip']);
    expect(existsSync(join(dir, 'plain.d.ts'))).toBe(false);
  });

  test('usage rejections exit 2: stdout collisions, stdin --dts-dir, out-of-tree mirroring', () => {
    write('typed.rip', typed);
    const collide = rip(['-c', '--dts', 'typed.rip']);
    expect(collide.status).toBe(2);
    expect(collide.stderr).toContain('--dts without -o prints the declarations alone');
    const stdin = rip(['--dts-dir', 'types'], { input: 'x = 1\n' });
    expect(stdin.status).toBe(2);
    expect(stdin.stderr).toContain('needs a file input');
    // Mirroring only works below the cwd — an escaping input is loud.
    const sub = join(dir, 'below');
    mkdirSync(sub, { recursive: true });
    const escape = spawnSync('bun', [BIN, '--dts-dir', 't', '../typed.rip'], { cwd: sub, encoding: 'utf8' });
    expect(escape.status).toBe(2);
    expect(escape.stderr).toContain('lies outside it');
  });

  test('containment is a path-segment test: a dot-prefixed NAME is in-tree, a `..` segment is not', () => {
    write('..inside.rip', 'q: number = 1\n');
    const r = rip(['--dts-dir', 'types', '..inside.rip']);
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, 'types/..inside.d.ts'), 'utf8')).toBe('declare let q: number;\nexport {};\n');
  });

  test('--dts is compile-mode only: a compile failure surfaces the normal diagnostic', () => {
    write('bad.rip', 'f(\n');
    const r = rip(['--dts', 'bad.rip']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('bad.rip');
  });
});

describe('cli: run surface (loader end-to-end)', () => {
  test('runs a .rip file directly', () => {
    write('answer.rip', 'console.log 6 * 7\n');
    const r = rip(['answer.rip']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('42\n');
  });

  test('multi-module .rip import chain with top-level await', () => {
    write('util.rip', 'export def double(x)\n  x * 2\n');
    write('lib.rip', 'import {double} from "./util.rip"\nexport base = await Promise.resolve(double(10))\n');
    write('main.rip', 'import {base} from "./lib.rip"\nconsole.log base + 1\n');
    const r = rip(['main.rip']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('21\n');
  });

  test('script arguments pass through to process.argv — including option-like ones', () => {
    write('argv.rip', 'console.log process.argv.slice(2).join(",")\n');
    const r = rip(['argv.rip', 'a', '--flag', 'c']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('a,--flag,c\n');
  });

  test('runs stdin source', () => {
    const r = rip([], { input: 'console.log 5 * 5\n' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('25\n');
  });

  test('stdin run never touches pre-existing files and leaves no scratch behind', () => {
    // A user file whose name matches the scratch prefix must survive
    // untouched — creation is exclusive, cleanup removes only the file
    // the CLI created.
    const decoy = join(dir, '.rip-stdin-decoy.rip');
    writeFileSync(decoy, 'DECOY');
    const r = rip([], { input: 'console.log "scratch ok"\n' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('scratch ok\n');
    expect(readFileSync(decoy, 'utf8')).toBe('DECOY');
    const leftovers = readdirSync(dir).filter((f) => f.startsWith('.rip-stdin-') && f !== '.rip-stdin-decoy.rip');
    expect(leftovers).toEqual([]);
    rmSync(decoy);
  });

  test('runtime stack traces resolve to .rip source lines', () => {
    write('crash.rip', 'def boom()\n  throw new Error("kapow")\n\nboom()\n');
    const r = rip(['crash.rip']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('kapow');
    // The throw is source line 2; the call is source line 4.
    expect(r.stderr).toMatch(/crash\.rip:2:\d+/);
    expect(r.stderr).toMatch(/crash\.rip:4(?::\d+)?\b/);
  });

  test('a nonzero process exit code propagates', () => {
    write('exit3.rip', 'process.exit 3\n');
    expect(rip(['exit3.rip']).status).toBe(3);
  });

  test('process.argv[1] is the entry file under run mode', () => {
    write('whoami.rip', 'console.log process.argv[1]\n');
    const r = rip(['whoami.rip']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toEndWith('whoami.rip');
  });
});

// Bun's own reporter shows GENERATED-JS coordinates for plugin-loaded
// modules (it never consults plugin-supplied source maps); the run
// harness remaps frames itself. These fixtures compile line-SHIFTED
// (a hoisted `let` plus a blank line push every statement down), so a
// frame that merely echoes generated coordinates cannot satisfy the
// source-position assertions — exactly the gap line-aligned fixtures
// mask. All runs happen from a bare temp cwd (no bunfig).
describe('cli: stack frames carry true .rip positions, not generated ones', () => {
  test('entry-module throw: function frame and call frame', () => {
    // Generated: throw at 4:13, call at 6:1. Source: throw's `Error`
    // at 2:13, call at 4:1.
    write('shifted.rip', 'greet = (name) ->\n  throw new Error "no greeting for #{name}"\n\ngreet "world"\n');
    const r = rip(['shifted.rip']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no greeting for world');
    expect(r.stderr).toMatch(/at greet \(.*shifted\.rip:2:13\)/);
    expect(r.stderr).toMatch(/at .*shifted\.rip:4(?![.\d])/);
    expect(r.stderr).not.toMatch(/shifted\.rip:4:13/);
    expect(r.stderr).not.toMatch(/shifted\.rip:6/);
  });

  test('throw inside an imported module: both modules remap', () => {
    // lib.rip: generated throw 4:13 → source 2:13. shiftmain.rip:
    // generated call 2:1 → source line 3.
    write('shiftlib.rip', 'greet = (name) ->\n  throw new Error "no greeting for #{name}"\n\nexport {greet}\n');
    write('shiftmain.rip', 'import {greet} from "./shiftlib.rip"\n\ngreet "world"\n');
    const r = rip(['shiftmain.rip']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/at greet \(.*shiftlib\.rip:2:13\)/);
    expect(r.stderr).toMatch(/at .*shiftmain\.rip:3(?![.\d])/);
    expect(r.stderr).not.toMatch(/shiftlib\.rip:4/);
  });

  test('async callback throw (uncaughtException path) remaps', () => {
    // Generated throw at 5:13 → source `Error` at 2:26.
    write('shifttick.rip', 'pad = 1\nsetTimeout (-> throw new Error "tick"), 1\n');
    const r = rip(['shifttick.rip']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('tick');
    expect(r.stderr).toMatch(/shifttick\.rip:2:26/);
    expect(r.stderr).not.toMatch(/shifttick\.rip:5/);
  });

  test('unhandled rejection (unhandledRejection path) remaps', () => {
    // Generated rejection site at 4:20 → source 2:20.
    write('shiftreject.rip', 'pad = 1\nPromise.reject new Error "nope"\n');
    const r = rip(['shiftreject.rip']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('nope');
    expect(r.stderr).toMatch(/shiftreject\.rip:2:20/);
    expect(r.stderr).not.toMatch(/shiftreject\.rip:4/);
  });

  // Lowered-IIFE cells: comprehensions, value-position try, and
  // value-position switch each wrap their body in an emitter IIFE, so
  // a throw inside one crosses synthetic scaffolding lines — the
  // frames must still land on exact .rip positions.
  test('throw inside an accumulator-IIFE comprehension: function frame and IIFE-interior call frame', () => {
    // Generated (Tier 1 declare-in-place): boom's throw on line 2, the
    // accumulator body's call at 7:17 (`result.push(boom(n))`). Source:
    // `Error` at 2:13, the `boom(n)` call at 4:8.
    write('shiftcomp.rip', 'boom = (x) ->\n  throw new Error "bad #{x}"\n\nout = (boom(n) for n in [1, 2])\n');
    const r = rip(['shiftcomp.rip']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('bad 1');
    expect(r.stderr).toMatch(/at boom \(.*shiftcomp\.rip:2:13\)/);
    expect(r.stderr).toMatch(/at <anonymous> \(.*shiftcomp\.rip:4:8\)/);
    // The push line's GENERATED position (7:17) must not leak — any
    // frame on generated line 7 carries segments and must remap.
    expect(r.stderr).not.toMatch(/shiftcomp\.rip:7/);
    // The module-level IIFE frame sits on scaffolding (`return result;`,
    // no segments) and passes through untouched by policy (stackmap.js).
    expect(r.stderr).toMatch(/at .*shiftcomp\.rip:9:10/);
  });

  test('throw inside a value-lowered try IIFE remaps', () => {
    // Generated: the catch's throw at 7:13 (the try IIFE opens on the
    // assignment line). Source: its `Error` at 5:13.
    write('shifttryv.rip', 'pad = 1\nv = try\n  throw new Error "inside try"\ncatch e\n  throw new Error "from catch: #{e.message}"\nconsole.log v\n');
    const r = rip(['shifttryv.rip']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('from catch: inside try');
    expect(r.stderr).toMatch(/at <anonymous> \(.*shifttryv\.rip:5:13\)/);
    expect(r.stderr).not.toMatch(/shifttryv\.rip:7:13/);
  });

  test('throw inside a value-lowered switch IIFE remaps', () => {
    // Generated: the case's throw at 6:15. Source: its `Error` at
    // 3:25 (the one-line `when … then throw` spelling).
    write('shiftswitchv.rip', 'k = 1\nv = switch k\n  when 1 then throw new Error "one"\n  else 2\nconsole.log v\n');
    const r = rip(['shiftswitchv.rip']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('one');
    expect(r.stderr).toMatch(/at <anonymous> \(.*shiftswitchv\.rip:3:25\)/);
    expect(r.stderr).not.toMatch(/shiftswitchv\.rip:6:15/);
  });

  test('a path containing spaces remaps end-to-end', () => {
    // The frame's location spans from the start of the path to the
    // trailing :line:col — whitespace inside the path is part of it.
    const spaced = mkdtempSync(join(tmpdir(), 'rip cli space-'));
    try {
      writeFileSync(join(spaced, 'crash.rip'), 'greet = (name) ->\n  throw new Error "no greeting for #{name}"\n\ngreet "world"\n');
      const r = spawnSync('bun', [BIN, 'crash.rip'], { cwd: spaced, encoding: 'utf8' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/at greet \(.*crash\.rip:2:13\)/);
      expect(r.stderr).not.toMatch(/crash\.rip:4:13/);
      expect(r.stderr).not.toMatch(/crash\.rip:6/);
    } finally {
      rmSync(spaced, { recursive: true, force: true });
    }
  });

  test('message text survives byte-identical while frames remap', () => {
    // The message deliberately contains this module's own registered
    // path followed by generated-looking coordinates; only FRAME
    // locations may change.
    write('msgsafe.rip', 'boom = ->\n  throw new Error "see #{process.argv[1]}:4:13 for details"\n\nboom()\n');
    const r = rip(['msgsafe.rip']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Error: see .*msgsafe\.rip:4:13 for details/);
    expect(r.stderr).toMatch(/at boom \(.*msgsafe\.rip:2:13\)/);
  });

  test("the entry's own uncaughtException handler wins over the harness fallback", () => {
    write('ownhandler.rip', [
      'process.on "uncaughtException", (err) ->',
      '  console.log "mine: #{err.message}"',
      '  process.exit 5',
      '',
      'setTimeout (-> throw new Error "handled here"), 1',
    ].join('\n') + '\n');
    const r = rip(['ownhandler.rip']);
    expect(r.status).toBe(5);
    expect(r.stdout).toContain('mine: handled here');
  });
});

describe('cli: diagnostics', () => {
  test('parse error: file:line:col, excerpt, exit 1', () => {
    write('parsebad.rip', 'a + * b\n');
    const r = rip(['parsebad.rip']);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain("parsebad.rip:1:5: Unexpected 'MATH'");
    expect(r.stderr).toContain('1 | a + * b');
    expect(r.stderr).toContain('^');
  });

  test('lexer error: file:line:col, exit 1', () => {
    write('lexbad.rip', 'x = 0XFF\n');
    const r = rip(['lexbad.rip']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("lexbad.rip:1:6: radix prefix in '0XFF' must be lowercase");
  });

  test('emitter rejection: positioned message with caret, exit 1', () => {
    write('emitbad.rip', 'v = 1\ndelete v\n');
    const r = rip(['emitbad.rip']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('emitbad.rip:2:1: emitter: delete requires a property reference');
    expect(r.stderr).toContain('2 | delete v');
  });

  test('compile mode reports the same diagnostics', () => {
    write('parsebad.rip', 'a + * b\n');
    const r = rip(['-c', 'parsebad.rip']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("parsebad.rip:1:5: Unexpected 'MATH'");
  });

  test('a compile error in an IMPORTED module fails the run with its position', () => {
    write('badmod.rip', 'z = (1 +\n');
    write('imports-bad.rip', 'import {z} from "./badmod.rip"\nconsole.log z\n');
    const r = rip(['imports-bad.rip']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/badmod\.rip:1:5: unclosed '\('/);
  });

  test('compile modes reject trailing arguments (run-mode argv stays passthrough)', () => {
    write('bump2.rip', 'x = 1\n');
    const bogus = rip(['-c', 'bump2.rip', '--definitely-bogus']);
    expect(bogus.status).toBe(2);
    expect(bogus.stderr).toContain('unexpected argument');
    expect(bogus.stderr).toContain('--definitely-bogus');
    const extra = rip(['-c', 'bump2.rip', 'extra.rip']);
    expect(extra.status).toBe(2);
    expect(extra.stderr).toContain('unexpected argument');
  });

  test('missing file exits 1; unknown option exits 2', () => {
    const missing = rip(['nope.rip']);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('file not found');
    const unknown = rip(['-z', 'nope.rip']);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain('unknown option');
  });
});

describe('compile(): the library boundary', () => {
  test('returns code plus a V3 map object', () => {
    const { code, map } = compile('x = 1\n', { path: 'unit.rip' });
    expect(code).toContain('x = 1;');
    expect(map.version).toBe(3);
    expect(map.sources).toEqual(['unit.rip']);
    expect(decodeMappings(map.mappings).length).toBeGreaterThan(0);
  });

  test('CompileError carries structured position fields', () => {
    let err = null;
    try {
      compile('a + * b\n', { path: 'unit.rip' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CompileError);
    expect(err.path).toBe('unit.rip');
    expect(err.line).toBe(1);
    expect(err.col).toBe(5);
    expect(err.start).toBe(4);
    expect(err.end).toBe(5);
    expect(err.message).toStartWith("unit.rip:1:5: Unexpected 'MATH'");
  });

  test('lexer rejections carry offsets through to CompileError', () => {
    let err = null;
    try {
      compile('x = 0XFF\n', { path: 'unit.rip' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CompileError);
    expect(err.line).toBe(1);
    expect(err.col).toBe(6);
    expect(err.message).toContain('radix prefix');
  });

  test('emitter rejections become positioned CompileErrors', () => {
    let err = null;
    try {
      compile('v = 1\ndelete v\n', { path: 'unit.rip' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CompileError);
    expect(err.start).toBe(6);
    expect(err.line).toBe(2);
    expect(err.col).toBe(1);
    expect(err.message).toStartWith('unit.rip:2:1: emitter:');
    expect(err.message).toContain('2 | delete v');
  });
});

// The emitter nesting bound: SAME-SHAPE chains (binary operator
// runs, member/method/call chains) emit ITERATIVELY, so legal flat
// chains never meet the bound at any practical length; the 1024
// bound remains for genuinely NESTED mixed shapes (every level a
// different construct — call args in call args, arrays in arrays),
// which reject as a positioned diagnostic, never a machine-dependent
// bare RangeError. The docs surface states the limit (README).
describe('emitter nesting bound', () => {
  const chain = (n) => 'z =\n' + Array.from({ length: n }, () => '  a < b >').join('\n') + '\n  c\n';

  test('flat chains compile far past the bound: comparisons, sums, concats, method chains', () => {
    // Comparison chains LOWER to conjunctions and still emit
    // iteratively — the deep chain compiles past the bound as the
    // conjunction, never as left-nested boolean comparisons.
    expect(compile(chain(2000), { path: 'deep.rip' }).code).toContain('(a < b) && (b > a)');
    const sum = 'x = ' + Array.from({ length: 2000 }, (_, i) => `a${i}`).join(' + ') + '\n';
    expect(compile(sum, { path: 'deep.rip' }).code).toContain('a1999');
    const concat = 'x = ' + Array.from({ length: 2000 }, (_, i) => `"s${i}"`).join(' + ') + '\n';
    expect(compile(concat, { path: 'deep.rip' }).code).toContain('"s1999"');
    const method = 'x = s' + '.f()'.repeat(2000) + '\n';
    expect(compile(method, { path: 'deep.rip' }).code).toContain('.f()');
  });

  test('genuinely nested mixed shapes reject at the bound with the positioned nesting-limit message', () => {
    for (const src of [
      'x = ' + 'f('.repeat(1030) + '1' + ')'.repeat(1030) + '\n',
      'x = ' + '['.repeat(1030) + '1' + ']'.repeat(1030) + '\n',
    ]) {
      let err = null;
      try {
        compile(src, { path: 'deep.rip' });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(CompileError);
      expect(err.message).toMatch(/^deep\.rip:\d+:\d+: emitter: expression nesting exceeds 1024 levels/);
      expect(err.message).toContain('^');
    }
  });

  test('no depth ever surfaces a bare RangeError (the compile() backstop)', () => {
    // Far past any bound the engine stack can die in a pre-emission
    // walk (hoist collection) before the expr counter is reached —
    // machine-dependent which guard fires, but BOTH are CompileErrors
    // naming the nesting problem.
    let err = null;
    try {
      compile(chain(40000), { path: 'deep.rip' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CompileError);
    expect(err.message).toMatch(/nesting exceeds 1024 levels|nests too deeply to emit/);
  });
});

// The rejection sweep: every emitter rejection class throws through
// positionedError, so compile() formats each as path:line:col with a
// caret — one representative program per swept family, the offending
// construct never on line 1 (a position of 2+ proves span resolution,
// not a default).
describe('emitter rejections carry source positions emitter-wide', () => {
  const cases = [
    ['void marker on a non-function value', 'pad = 1\nsave! = 5', 2],
    ['rest as a destructuring target', 'pad = 1\n[a, rest b] = xs', 2],
    ['overload signature without implementation', 'pad = 1\ndef f(x: number): number', 2],
    // A bare member is a primitive with no NodeStore row — its span
    // derives from the block row and its recorded neighbors, so the
    // caret lands on the member itself (both list positions pinned).
    ['enum member without a value', 'pad = 1\nenum Color\n  red', 3],
    ['bare enum member mid-list', 'pad = 1\nenum C\n  a = 1\n  red\n  b = 2', 4],
    ['enum member with an expression value', 'pad = 1\nenum C\n  a = f()', 3],
    ['enum duplicate key', 'pad = 1\nenum C\n  a = 1\n  b = 1', 4],
    ['BY step of 0', 'pad = 1\nfor x in xs by 0\n  f x', 2],
    ['for…of pattern key with own', 'pad = 1\nfor own [k] of o\n  f k', 2],
    ['for-as with two loop variables', 'pad = 1\nfor a, b as xs\n  f a', 2],
    ['return of a value from a void function', 'f! = ->\n  pad = 1\n  return 5', 3],
    ['super outside a class method', 'pad = 1\nx = super.a', 2],
    ['computed key shorthand', 'pad = 1\nx = {[k]}', 2],
    ['@-key outside a class body', 'pad = 1\nx = {@a: 1}', 2],
    ['negative-literal index as assignment target', 'pad = 1\nxs[-1] = 5', 2],
    ['unsupported class member', 'pad = 1\nclass A\n  if x\n    1', 3],
    ['bound method without a constructor', 'pad = 1\nclass A\n  m: => 1', 3],
    ['class field with a colon value', 'pad = 1\nclass A\n  x: f()', 3],
    ['constructor with the void marker', 'pad = 1\nclass A\n  constructor!: -> f()', 3],
    ['type declaration as a class member', 'pad = 1\nclass A\n  type T = number', 3],
    ['fat arrow containing yield', 'pad = 1\nf = =>\n  yield 1', 2],
    ['multi-statement interpolation', 'pad = 1\ns = "#{a; b}"', 2],
    ['do-IIFE pattern parameter', 'pad = 1\ndo ([a]) -> a', 2],
  ];
  for (const [label, src, line] of cases) {
    test(`${label} → positioned at line ${line}`, () => {
      let err = null;
      try {
        compile(src + '\n', { path: 'demo.rip' });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(CompileError);
      expect(err.message).toMatch(new RegExp(`^demo\\.rip:${line}:\\d+: emitter:`));
      expect(err.message).toContain('^');
      expect(err.line).toBe(line);
      expect(typeof err.col).toBe('number');
    });
  }
});

describe('remapStack: frame lines remap, message lines never change', () => {
  test('V8 frame shapes rewrite; a message containing path:line:col does not', () => {
    // Tier 1 declare-in-place removed the hoist line, which made this
    // sample's generated lines coincide with its source lines — a
    // leading comment (dropped by the compiler) keeps them distinct so
    // the remap stays observable: greet's throw is generated 2:13 →
    // source 3:13, the call generated 4:1 → source 5:1.
    const source = '# padding line: keeps generated lines distinct from source lines\ngreet = (name) ->\n  throw new Error "x"\n\ngreet "y"\n';
    const path = '/tmp/spaced dir/unit msg.rip';
    const { map } = compile(source, { path });
    registerModuleMap(path, map);

    const stack = [
      `Error: see ${path}:2:13 and call ${path}:4:1`,
      `    at greet (${path}:2:13)`,
      `    at ${path}:4:1`,
      '    at other (/elsewhere/not-registered.js:9:9)',
    ].join('\n');

    expect(remapStack(stack).split('\n')).toEqual([
      `Error: see ${path}:2:13 and call ${path}:4:1`,
      `    at greet (${path}:3:13)`,
      `    at ${path}:5:1`,
      '    at other (/elsewhere/not-registered.js:9:9)',
    ]);
  });
});

describe('loader: in-process imports through the bunfig preload', () => {
  test('.rip modules import directly inside this test process', async () => {
    const d = mkdtempSync(join(tmpdir(), 'rip-loader-'));
    try {
      writeFileSync(join(d, 'dep.rip'), 'export def triple(x)\n  x * 3\n');
      writeFileSync(join(d, 'entry.rip'), [
        'import {triple} from "./dep.rip"',
        'export answer = await Promise.resolve(triple(14))',
      ].join('\n'));
      const mod = await import(pathToFileURL(join(d, 'entry.rip')).href);
      expect(mod.answer).toBe(42);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('a compile error surfaces as CompileError with position', async () => {
    const d = mkdtempSync(join(tmpdir(), 'rip-loader-'));
    try {
      writeFileSync(join(d, 'broken.rip'), 'f(a))\n');
      let err = null;
      try {
        await import(pathToFileURL(join(d, 'broken.rip')).href);
      } catch (e) {
        err = e;
      }
      expect(err).not.toBeNull();
      expect(err.message).toMatch(/broken\.rip:1:5: unmatched '\)'/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
