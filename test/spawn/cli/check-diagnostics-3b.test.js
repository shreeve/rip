// `rip check` — type diagnostics over the real server, part 3b of 6
// (cases 30–40 of the former part 3; see check-diagnostics-1a.test.js for why the
// describe is split). The runner and workspace builders live in
// ./support/check-harness.js.

import { test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { describeExtended } from '../../support/extended.js';
import { workspace, monorepo, freshProject, check } from './support/check-harness.js';

describeExtended('rip check: type diagnostics over the real server', () => {
  test('the same project is quiet before anything is installed', () => {
    const dir = freshProject({ withTypes: false });
    try {
      expect(JSON.parse(check(dir, ['--json']).stdout)).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // A name TypeScript cannot type is `any` — it says so itself, and
  // says it TWICE: TS7016 for a .js module with no declarations, which
  // gradual has always suppressed, and TS2582 for a test-runner global
  // used bare, which it did not. Same situation, same posture. The
  // binding is `any` either way, so nothing downstream changes; what
  // changes is whether the advisory is shouted at a project that did not
  // ask for it. (Node's modules are not a case here any more: `fs` is
  // typed from the checkout's `@types/bun`.)
  test('a missing test-runner declaration is advisory in gradual mode, an error under strict', () => {
    const files = { 'app.rip': "describe 'adds', ->\n  1\n" };
    const gradual = workspace(files);
    const strict = workspace(files, { strict: true });
    try {
      expect(JSON.parse(check(gradual, ['--json']).stdout)).toEqual([]);
      // Strict still says it, so the suppression is a MODE, not a deletion.
      expect(JSON.parse(check(strict, ['--json']).stdout).map((d) => d.code)).toEqual([2582]);
    } finally {
      fs.rmSync(gradual, { recursive: true, force: true });
      fs.rmSync(strict, { recursive: true, force: true });
    }
  }, 60_000);

  // `noImplicitThis` rides the strict umbrella, and TS2683's own message
  // is "'this' implicitly has type 'any'" — the same class the 7xxx family
  // covers, numbered outside it. `@req` in a handler is a receiver the
  // author never annotated and has no obvious spelling to annotate, so
  // demanding one is annotation pressure by another route.
  test("an unannotated `this` is quiet in gradual mode, an error under strict", () => {
    const files = { 'app.rip': 'handler = -> @req\nconsole.log handler\n' };
    const gradual = workspace(files);
    const strict = workspace(files, { strict: true });
    try {
      expect(JSON.parse(check(gradual, ['--json']).stdout)).toEqual([]);
      expect(JSON.parse(check(strict, ['--json']).stdout).map((d) => d.code)).toEqual([2683]);
    } finally {
      fs.rmSync(gradual, { recursive: true, force: true });
      fs.rmSync(strict, { recursive: true, force: true });
    }
  }, 60_000);

  // The line that must NOT move: a module nothing can resolve stays an
  // error. Typos, missing dependencies, and rip's own unresolved
  // workspace packages all live here, and TypeScript's own code is what
  // separates them from the advisory above.
  test('an unresolvable module is still an error in gradual mode', () => {
    const dir = workspace({ 'app.rip': "import { x } from 'totally-not-a-package'\nconsole.log x\n" });
    try {
      expect(JSON.parse(check(dir, ['--json']).stdout).map((d) => d.code)).toEqual([2307]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('the polarity inverts with the configs — strict root, loose nested', () => {
    const dir = monorepo({ rootStrict: true, nestedStrict: false });
    try {
      const j = JSON.parse(check(dir, ['--json']).stdout);
      const at = (file) => j.filter((d) => d.file === file && d.code === 2322);
      expect(at('root.rip').length, 'the root file rejects under the strict root').toBe(1);
      expect(at('pkg/a.rip').length, 'the nested file stays loose under its own config').toBe(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('a file that does not parse reports its CompileError beside the type errors of the rest, exits 1, and says nothing on stderr', () => {
    const dir = workspace({
      'lib.rip': 'export ratio: number = 0.5\nexport def scale(n: number): number\n  n * ratio\n',
      'app.rip': "import { scale } from './lib.rip'\nlabel: string = scale(2)\nconsole.log label\n",
      'bad.rip': 'zz = (1\n',
    });
    try {
      const r = check(dir);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('app.rip:2:1 - error');
      expect(r.stdout).toContain("bad.rip:1:6 - error: unclosed '('");
      expect(r.stderr).toBe('');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('a __DATA__ payload is not code: it seeds no binding, it is never lexed, and the advisories do not read it', () => {
    // The gate reads the compile's own token tape — the text before the
    // marker — so a payload the lexer would refuse still leaves the file
    // gated, and an annotation spelled inside the payload types nothing.
    const dir = workspace({
      'held.rip': "x = 1\ny = x.bar.baz\nconsole.log y\n__DATA__\nit's payload\nn: number = 1\n# @ts-ignore\n",
      'shown.rip': "z: number = 'oops'\nconsole.log z\n__DATA__\nit's payload\n",
    });
    try {
      const r = check(dir);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('shown.rip:1:1 - error');
      expect(r.stdout).not.toContain('held.rip:');
      expect(r.stdout).toContain('1 diagnostic hidden in unannotated code');
      expect(r.stdout).not.toContain('@ts-ignore');
      expect(r.stderr).toBe('');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  test('a package that installs its own ambient types earns its own program: the install binds there and nowhere else', () => {
    // Ambient declarations bind per PROGRAM through typeRoots, which walk
    // up from the program root and never down into a member — so a nested
    // install is unread until the member has its own program. The global
    // resolves inside the installing package, and stays a defect outside
    // it (the cannot-find family reports under every mode).
    const dir = workspace({
      'root.rip': 'console.log FOO_MARK\n',
      'pkg/package.json': '{}',
      'pkg/node_modules/@types/foo/package.json': '{"name":"@types/foo","version":"1.0.0","types":"index.d.ts"}',
      'pkg/node_modules/@types/foo/index.d.ts': 'declare var FOO_MARK: number;\n',
      'pkg/a.rip': 'console.log FOO_MARK\n',
    });
    try {
      const r = check(dir, ['--json']);
      const rows = JSON.parse(r.stdout);
      expect(rows.map((d) => [d.file, d.code])).toEqual([['root.rip', 2304]]);
      expect(r.status).toBe(1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  // Foreign projects (a closure's dependencies) are named on the line;
  // the home project stays unnamed. The remedy is an import wherever the
  // name is used, so it never points anywhere.
  test('the missing-types line names foreign projects, and the remedy is the import', () => {
    const dep = {
      'pkg/package.json': '{}',
      'pkg/b.rip': "describe 'adds', ->\n  1\nexport ok = 1\n",
      'a.rip': "import { ok } from './pkg/b.rip'\nconsole.log ok\n",
    };
    const foreign = workspace(dep);
    const mixed = workspace({ ...dep, 'a.rip': "import { ok } from './pkg/b.rip'\nit 'runs', ->\n  1\nconsole.log ok\n" });
    try {
      const f = check(foreign).stdout;
      expect(f).toMatch(/missing-types advisor(y|ies) hidden \(pkg\) — no declarations for `describe` \(import it from `bun:test`\)/);
      const m = check(mixed).stdout;
      expect(m).toMatch(/missing-types advisor(y|ies) hidden \(pkg\) — no declarations for `describe`, `it` \(import them from `bun:test`\)/);
    } finally {
      fs.rmSync(foreign, { recursive: true, force: true });
      fs.rmSync(mixed, { recursive: true, force: true });
    }
  }, 90_000);

  test('the stash types the app: bare gates and computeds infer from app/stash.rip, in a directory check and a single-file one', () => {
    // The project anchor (index.rip + package.json) discovers the stash;
    // the face splices `import('<rel>').__RipStash` with no source
    // import, so the stash must ride the closure like an import — the
    // single-file run is the case that would leave it unmaterialized.
    const files = {
      'index.rip': "console.log 'serve'\n",
      'app/stash.rip': "export type Todo =\n  id: number\n  label: string\n\ntodos: Todo[] = []\n\nexport stash =\n  todos: todos\n",
      'app/routes/page.rip': "export Page = component\n  todos ~= @stash.todos\n  labels ~= todos.map((t) -> t.label)\n  q ~= @router.query.q ?? ''\n  render null\n",
    };
    const dir = workspace(files, { strict: true });
    try {
      const whole = check(dir, ['--json']);
      expect(JSON.parse(whole.stdout)).toEqual([]);
      const single = check(dir, ['app/routes/page.rip', '--json']);
      expect(JSON.parse(single.stdout)).toEqual([]);
      // The face carries the splice; the stash face carries its type.
      const face = fs.readFileSync(path.join(dir, '.rip/check/app/routes/page.rip.ts'), 'utf8');
      expect(face).toContain("import('rip/app').StashData<import(\"../stash.rip\").__RipStash>");
      // The router rides the same discovery: the ambience carries the
      // runtime's Router — with a route tree present, the union-checked
      // construction (Omit keeps every non-navigation member, so the
      // bare `q ~= @router.query.q` above must survive the strict run).
      expect(face).toContain("router?: Omit<import('rip/app').Router, 'push' | 'replace'>");
      const stashFace = fs.readFileSync(path.join(dir, '.rip/check/app/stash.rip.ts'), 'utf8');
      expect(stashFace).toContain('export type __RipStash = typeof stash;');
      // A WRONG stash path squiggles, on the computed road (the class
      // ambience types the `_init` copy — the mapped one) AND on the
      // gate road (the face twin IS the read the author wrote) — instead
      // of collapsing to error-`any`.
      fs.writeFileSync(path.join(dir, 'app/routes/typo.rip'), "export Typo = component\n  bad ~= @stash.missing\n  worse <~ @stash.absent\n  render null\n");
      const typo = check(dir, ['app/routes/typo.rip', '--json']);
      const typoRows = JSON.parse(typo.stdout);
      expect(typoRows.some((d) => d.code === 2339 && /missing/.test(d.message))).toBe(true);
      expect(typoRows.some((d) => d.code === 2339 && /absent/.test(d.message))).toBe(true);
      // Without the anchor the same route types nothing and strict says so.
      const bare = workspace({ 'page.rip': files['app/routes/page.rip'] }, { strict: true });
      try {
        const r = check(bare, ['--json']);
        expect(JSON.parse(r.stdout).some((d) => d.code === 7006)).toBe(true);
      } finally { fs.rmSync(bare, { recursive: true, force: true }); }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);

  test('--strict reports what rip.strict would: the same report as the same workspace with rip.strict set, nothing edited', () => {
    // Both postures are exercised: per file (an unannotated read the gate
    // would hold, an implicit-any parameter) and per program (a null the
    // loosened posture admits, a host name typed from the checkout's
    // `@types/bun` in both),
    // and across a package boundary (a nested package with its own
    // rip.strict beside a gradual root — the mode flip that earns its own
    // program). Rows compare whole: file, position, severity, code,
    // message, related.
    const files = {
      'a.rip': "x = 1\ny = x.bar.baz\ndef f(n)\n  n\nz: string = null\nconsole.log y, f(1), z, process.argv\n",
      'pkg/b.rip': "w: string = null\nconsole.log w\n",
    };
    const gradual = workspace({ ...files, 'pkg/package.json': JSON.stringify({ rip: { strict: true } }) });
    const strict = workspace({ ...files, 'pkg/package.json': JSON.stringify({ rip: { strict: true } }) }, { strict: true });
    try {
      const plain = check(gradual, ['--json']);
      const forced = check(gradual, ['--strict', '--json']);
      const real = check(strict, ['--json']);
      const rows = (r) => JSON.parse(r.stdout);
      expect(plain.status).toBe(1);                       // the nested strict package reports on its own
      expect(rows(plain).map((d) => d.file)).toEqual(['pkg/b.rip']);
      expect(forced.status).toBe(1);
      expect(rows(forced)).toEqual(rows(real));           // --strict ≡ rip.strict, row for row
      expect(rows(forced).map((d) => d.code)).toEqual(expect.arrayContaining([2339, 7006, 2322]));
      expect(fs.readFileSync(path.join(gradual, 'package.json'), 'utf8')).toBe('{}');
      expect(forced.stderr).toBe('');
      // The text report says the posture was forced; the plain one does not.
      expect(check(gradual, ['--strict']).stdout).toContain('checked under --strict');
      expect(check(gradual).stdout).not.toContain('checked under --strict');
    } finally {
      fs.rmSync(gradual, { recursive: true, force: true });
      fs.rmSync(strict, { recursive: true, force: true });
    }
  }, 120_000);
});
