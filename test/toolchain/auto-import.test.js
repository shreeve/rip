// Auto-import candidate scope: a candidate is offered only from tsgo's
// PROGRAM, so the question is which mirrors are in it. Every workspace
// `.rip` now gets a declaration-only STUB mirror at startup — bytes
// written and announced, registered nowhere — so auto-import's headline
// case (import from a file you have not opened) works for `.rip` → `.rip`
// as it already did for npm/@types.
//
// This file was the interim gate for the gap and asserted the wrong
// behavior with `not.toContain`; it is now inverted. What survives the
// inversion is the reason `test.failing` was rejected: under it any throw
// counts as a pass, so a server returning no completions at all — tsgo
// dead, mapping broken — would be reported green, indistinguishable from
// a real answer. Every completion assertion is therefore paired with a
// liveness check, so an empty list can only ever be a real failure. The
// same discipline governs the surfaces added below: `definitions()` and
// `hover()` poll for a live answer, because EMPTY is exactly what the
// wrong implementation produces and it must never be confusable with
// "tsgo had not finished building".
//
// The three surfaces after the scope tests are what a wrong stub breaks
// SILENTLY. Registering a stub — putting it in `materializedMirrors` or
// the cache manifest — makes `materializeClosure` short-circuit and never
// write the real face over it; the completion tests above stay green
// while hover degrades to `any`, go-to-definition returns nothing, and a
// genuine type error disappears. Nothing else in the suite would notice.
import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { openSession } from '../support/lsp-session.js';
import { describeExtended } from '../support/extended.js';
import { scanExportNames, buildStubFaces, stubFace } from '../../packages/vscode/src/mirror.js';

// app imports a, a imports util  →  `shout` is IN the closure.
// orphan is imported by nothing  →  `orphanWidget` is OUT of it.
const FILES = {
  'util.rip': 'export shout = (s: string): string -> s.toUpperCase()\n',
  'a.rip': "import { shout } from './util.rip'\nexport relay = (s: string): string -> shout(s)\n",
  'orphan.rip': 'export orphanWidget = (): string -> "widget"\n',
  'app.rip': "import { relay } from './a.rip'\nconsole.log relay('x')\nfirst = sh\nsecond = orph\n",
  'package.json': '{}\n',
};

// Two completion sites, one per candidate, because tsgo filters auto-import
// candidates BY PREFIX: asking at `sh` can never offer `orphanWidget`, no
// matter what the program contains — a probe at the wrong prefix would read a
// filtered-out name as an unreachable one and "reproduce" the gap against a
// server that had it fixed. The site must also be an expression position: a
// bare identifier statement does not map cleanly into the face and answers
// with no completions at all.
const SHOUT = { line: 2, col: 10 };          // `first = sh|`
const ORPHAN = { line: 3, col: 13 };         // `second = orph|`

// Every completion assertion goes through here: a list must be LIVE before its
// membership means anything. An empty list satisfies any `not.toContain` for
// free, which would make a scope test pass for the wrong reason.
async function candidatesAt(session, pos) {
  const labels = await session.completions('app.rip', pos.line, pos.col);
  expect(labels.length).toBeGreaterThan(0);
  return labels;
}

// The mirror a source file gets, at the layout the server generates.
const mirrorOf = (session, name) => path.join(session.dir, '.rip', 'editor', name + '.ts');

// Stub population is backgrounded on purpose — it must never sit in front
// of the first diagnostics — so a test that depends on it waits for the
// bytes rather than for a fixed interval.
async function awaitStub(session, name, { tries = 100, every = 100 } = {}) {
  const at = mirrorOf(session, name);
  for (let i = 0; i < tries; i++) {
    if (fs.existsSync(at)) return fs.readFileSync(at, 'utf8');
    await new Promise((r) => setTimeout(r, every));
  }
  throw new Error(`no mirror for ${name} within ${(tries * every) / 1000}s — stub population never ran`);
}

// ---- the source scan, without a server. The stub is built by reading
// export lines rather than compiling, so the scan's blind spots are the
// feature's blind spots: a name it misses is a candidate nobody is
// offered. The re-export case is here because a per-line scan that read
// only declarations missed exactly one of the real workspace's candidates.
test('the export scan reads the forms a workspace actually writes', () => {
  const scan = scanExportNames([
    "export { delay, debounce } from './timing.rip'",   // names stated by a RE-EXPORT
    "export { hold as wait } from './timing.rip'",      // the alias is the exported name
    "export { default as theme } from './theme.rip'",
    'export {',                                          // a multi-line list, newline-separated
    '  alpha',
    '  beta as second',
    '}',
    'export shout = (s: string): string -> s.toUpperCase()',
    'export ready! = -> 1',                              // rip binding markers keep the name
    'export count := 0',
    'export Options<T extends string> = component',
    'export class Widget',
    'export type Padding = number',
    'export interface Config',
    'export enum Priority',
  ].join('\n'));
  expect(scan.values.sort()).toEqual(
    ['Options', 'Priority', 'Widget', 'alpha', 'count', 'debounce', 'delay', 'ready', 'second', 'shout', 'theme', 'wait'],
  );
  // A class and an enum occupy BOTH declaration spaces; a type alias and a
  // variable of the same name are legal together, which is what lets the
  // stub say so.
  expect(scan.types.sort()).toEqual(['Config', 'Padding', 'Priority', 'Widget']);
});

// THE LINE THAT LANDS IN THE BUFFER, which is the feature's whole payoff
// and which nothing here asserted until it shipped wrong. Offering a
// candidate and inserting a usable line are different claims: the label
// arrives on the first response, the edit only on `completionItem/resolve`,
// so a test that stops at the label never sees what the user gets.
//
// The specifier must be SINGLE-quoted. tsgo mints double; Rip source does
// not (320 of the 320 `from` imports in this repo's `.rip` files are
// single). There IS a re-quoting pass that matches the user's own style,
// but it learns that style from an existing import of the same module —
// and an auto-import is by definition of a module nothing has imported
// yet, so it never fires here. The fixture therefore imports NOTHING,
// which is the only state that exercises the default.
describeExtended('the inserted import is idiomatic Rip', () => {
  const FRESH = {
    'widget.rip': 'export uniqueWidgetName = (n: number): string -> "w"\n',
    'blank.rip': "console.log 'x'\nfirst = uniqueWidg\n",
    'package.json': '{}\n',
  };

  test('a brand-new auto-import inserts a single-quoted, semicolon-free line', async () => {
    const s = await openSession(FRESH);
    try {
      await awaitStub(s, 'widget.rip');
      s.open('blank.rip');
      await s.diagnostics('blank.rip');
      const item = await s.completionItem('blank.rip', 1, 17, 'uniqueWidgetName');
      expect(item, 'the candidate is offered at all').toBeTruthy();
      const edits = item.additionalTextEdits ?? [];
      expect(edits.length, 'an auto-import carries its import line').toBeGreaterThan(0);
      const text = edits.map((e) => e.newText).join('');
      expect(text).toContain("from './widget.rip'");
      expect(text).not.toContain('"');       // tsgo's double quotes, gone
      expect(text).not.toContain(';');       // Rip parses one; no Rip author writes one
      expect(text).not.toContain('.rip.ts'); // the mirror extension never reaches the user
    } finally { await s.close(); }
  }, 90_000);
});

// A default export has no name for the stub to carry, so it needs its own
// answer. Omitted, every consumer that imports it — `import theme from
// './x.rip'`, `import { default as theme }`, `export { default } from` —
// draws TS1192/TS2305 off the stub, which is candidacy buying an error.
test('a default export is carried, however it is spelled', () => {
  expect(scanExportNames('export default host.toUpperCase()\n').hasDefault).toBe(true);
  expect(scanExportNames("export { default } from './lib.rip'\n").hasDefault).toBe(true);
  expect(scanExportNames('export { palette as default }\n').hasDefault).toBe(true);
  // The NAME is the mechanism, not decoration. A default export is offered
  // under a name TypeScript derives from the file, and that derivation needs
  // a declaration it will name — an identifier with a LEADING DOUBLE
  // underscore is escaped in TypeScript's symbol tables (`__x` → `___x`) and
  // the default then has no candidate at all. Driven both ways, every other
  // byte identical: `__ripDefault` offered nothing, `_default` offers it.
  // `_default` is also what TypeScript's own .d.ts emitter writes here.
  expect(stubFace(scanExportNames('export default 1\n'))).toContain('declare const _default: any;');
  expect(stubFace(scanExportNames('export default 1\n'))).toContain('export default _default;');
  expect(stubFace(scanExportNames('export default 1\n'))).not.toMatch(/\b__/);
});

// The NAME the default is OFFERED under, which is the local it binds. A
// named declaration beats TypeScript's own derivation from the file — and
// the file here is a MIRROR, `theme.rip.ts`, which derives `themeRip` where
// the author's file says `theme`. Driven both ways.
test('a default export is offered under the source file\'s own name', () => {
  const faces = buildStubFaces(
    ['/w/theme.rip', '/w/10-modules.rip', '/w/my-widget.rip', '/w/theme2.rip', '/w/__hidden.rip'],
    (f) => (f.endsWith('theme2.rip') ? 'export default 1\nexport theme2 = 1\n' : 'export default 1\n'),
  );
  const def = (f) => faces.get(f).split('\n').find((l) => l.startsWith('export default'));
  expect(def('/w/theme.rip')).toBe('export default theme;');
  // Sanitized: a hyphen is not an identifier character.
  expect(def('/w/my-widget.rip')).toBe('export default my_widget;');
  // The three fallbacks, each for its own reason: a leading digit cannot
  // start an identifier; the name is already exported by this module, so
  // binding it twice would not compile; and a leading DOUBLE underscore is
  // escaped in TypeScript's symbol tables, which kills the candidate
  // outright. All land on `_default`, which still works — it just answers
  // with TypeScript's file-derived spelling.
  expect(def('/w/10-modules.rip')).toBe('export default _default;');
  expect(def('/w/theme2.rip')).toBe('export default _default;');
  expect(def('/w/__hidden.rip')).toBe('export default _default;');
});

// A file named for a RESERVED WORD. `default.rip` is the plausible one, and
// the whole set is here because the guard is a list and a list is exactly
// what rots. Each of these cannot be a `const` binding — `declare const
// default: any;` is a SYNTAX error (TS1389 and friends), so the stub stops
// parsing and the default it exists to offer is lost. Named exports survive
// (tsgo error-recovers), which is why this degrades quietly rather than
// failing loudly, and why it needs a gate rather than a comment.
test('a file named for a reserved word falls back rather than emitting a syntax error', () => {
  const RESERVED = [
    'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
    'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false',
    'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let',
    'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try',
    'typeof', 'var', 'void', 'while', 'with', 'yield',
  ];
  const faces = buildStubFaces(RESERVED.map((n) => `/w/${n}.rip`), () => 'export default 1\n');
  for (const name of RESERVED) {
    expect(faces.get(`/w/${name}.rip`), `${name}.rip must not bind its own name`)
      .toContain('export default _default;');
  }
  // And NOT over-broad: these are contextual keywords, legal as bindings,
  // so a file named for one keeps the name the author would write. Driven
  // against the real compiler, not assumed.
  const ctx = ['type', 'as', 'of', 'from', 'any', 'never'];
  const okFaces = buildStubFaces(ctx.map((n) => `/w/${n}.rip`), () => 'export default 1\n');
  for (const name of ctx) {
    expect(okFaces.get(`/w/${name}.rip`), `${name} binds fine and must not fall back`)
      .toContain(`export default ${name};`);
  }
  // A named re-export of someone else's default is a NAMED export here,
  // not a default one.
  const resold = scanExportNames("export { default as theme } from './lib.rip'\n");
  expect(resold.values).toEqual(['theme']);
  expect(resold.hasDefault).toBe(false);
  // `export * from` is defined to skip the target's default.
  expect(scanExportNames("export * from './lib.rip'\n").hasDefault).toBe(false);
});

test('a block string that contains an export line is not read as one', () => {
  const scan = scanExportNames([
    'export real = 1',
    'TEMPLATE = """',
    'export planted = 2',
    '"""',
    'export alsoReal = 3',
  ].join('\n'));
  expect(scan.values.sort()).toEqual(['alsoReal', 'real']);
});

test('`export * from` contributes the target file\'s names', () => {
  const sources = {
    '/w/index.rip': "export * from './lib.rip'\nexport own = 1\n",
    '/w/lib.rip': 'export deep = 2\nexport type Deep = string\n',
  };
  const faces = buildStubFaces(Object.keys(sources), (f) => sources[f] ?? null);
  expect(faces.get('/w/index.rip')).toContain('export declare const deep: any;');
  expect(faces.get('/w/index.rip')).toContain('export type Deep = any;');
  expect(faces.get('/w/index.rip')).toContain('export declare const own: any;');
});

describeExtended('auto-import candidate scope', () => {
  test('a candidate reachable through the import closure IS offered', async () => {
    const s = await openSession(FILES);
    try {
      s.open('app.rip');
      await s.diagnostics('app.rip');
      expect(await candidatesAt(s, SHOUT)).toContain('shout');   // app → a → util
    } finally { await s.close(); }
  }, 90_000);

  // THE HEADLINE CASE, and the inversion of what this test used to pin: a
  // workspace `.rip` that no open buffer reaches is offered anyway, from
  // cold, with no didOpen and no import edge. Opening it changes nothing —
  // it was already a candidate — which is the difference from the closure
  // behaviour this file recorded before.
  test('an UNIMPORTED workspace .rip IS offered without ever being opened', async () => {
    const s = await openSession(FILES);
    try {
      s.open('app.rip');                                          // orphan stays closed
      await s.diagnostics('app.rip');
      await awaitStub(s, 'orphan.rip');
      expect(await candidatesAt(s, ORPHAN)).toContain('orphanWidget');

      s.open('orphan.rip');                                       // and opening it keeps it
      await s.diagnostics('orphan.rip');
      expect(await candidatesAt(s, ORPHAN)).toContain('orphanWidget');
    } finally { await s.close(); }
  }, 90_000);

  // BYTES ONLY, stated where it is checkable. A stub in the cache manifest
  // would make `materializeClosure` short-circuit and never overwrite it;
  // a stub in the manifest would also make `pruneClosure` delete it. The
  // whole design is that neither collection has ever heard of it.
  test('a stub is bytes on disk and nothing else — no manifest entry', async () => {
    const s = await openSession(FILES);
    try {
      s.open('app.rip');
      await s.diagnostics('app.rip');
      const stub = await awaitStub(s, 'orphan.rip');
      expect(stub).toBe('export declare const orphanWidget: any;\nexport {};\n');
      const manifest = JSON.parse(fs.readFileSync(path.join(s.dir, '.rip', 'editor', '.cache.json'), 'utf8'));
      expect(Object.keys(manifest.entries)).not.toContain(path.join(s.dir, 'orphan.rip'));
      // The closure's own members are registered exactly as before.
      expect(Object.keys(manifest.entries)).toContain(path.join(s.dir, 'util.rip'));
    } finally { await s.close(); }
  }, 90_000);

  // Prune survival, driven rather than reasoned about: removing the import
  // line prunes `a.rip`/`util.rip` out of the program, and the stub — which
  // pruning iterates neither collection to find — is still offered after.
  test('a stub survives a prune that empties the closure', async () => {
    const s = await openSession(FILES);
    try {
      s.open('app.rip');
      await s.diagnostics('app.rip');
      await awaitStub(s, 'orphan.rip');
      expect(await candidatesAt(s, ORPHAN)).toContain('orphanWidget');

      s.change('app.rip', "console.log 'x'\nfirst = sh\nsecond = orph\n");   // the import edge goes
      await s.diagnostics('app.rip');
      await new Promise((r) => setTimeout(r, 1500));                          // the prune is backgrounded
      expect(fs.existsSync(mirrorOf(s, 'orphan.rip'))).toBe(true);
      expect(await candidatesAt(s, { line: 2, col: 13 })).toContain('orphanWidget');
    } finally { await s.close(); }
  }, 90_000);
});

// ACCEPT, THEN CHANGE YOUR MIND — the sequence that made the prune's own
// bookkeeping eat candidacy. Accepting an auto-import puts the target IN the
// closure (real face, registered); removing the import takes it back out and
// the prune deletes the mirror it registered. Nothing then spoke for the
// file, so it stopped being a candidate until the next session — reachable
// in about fifteen seconds of ordinary editing, and curable only by a
// restart nobody would guess at.
//
// The prune is right to delete the FACE. What has to come back is the stub.
describeExtended('candidacy survives an import being removed', () => {
  const CYCLE = {
    'widget.rip': 'export uniqueWidgetName = (n: number): string -> "w"\n',
    'test.rip': "console.log 'x'\nfirst = uni\n",
    'package.json': '{}\n',
  };
  const AT = { line: 1, col: 11 };   // `first = uni|`
  // candidatesAt() is bound to the shared app.rip fixture; this suite has its
  // own document, so it carries its own liveness-checked read.
  const offered = async (s) => {
    const labels = await s.completions('test.rip', AT.line, AT.col);
    expect(labels.length, 'the list is live before its membership means anything').toBeGreaterThan(0);
    return labels;
  };

  test('a file offered, imported, then un-imported is offered again', async () => {
    const s = await openSession(CYCLE);
    try {
      await awaitStub(s, 'widget.rip');
      s.open('test.rip');
      await s.diagnostics('test.rip');
      expect(await offered(s)).toContain('uniqueWidgetName');

      // Accept: the import edge exists, so the file joins the closure and
      // its stub is replaced by a real compiled face.
      s.change('test.rip', "import { uniqueWidgetName } from './widget.rip'\nconsole.log 'x'\nfirst = uni\n");
      await s.diagnostics('test.rip');

      // Change your mind. The edge goes, the prune runs, the face is
      // removed — and the name must still be offered.
      s.change('test.rip', "console.log 'x'\nfirst = uni\n");
      await s.diagnostics('test.rip');
      await new Promise((r) => setTimeout(r, 1500));   // the prune is backgrounded
      expect(await offered(s)).toContain('uniqueWidgetName');
      // And what came back is the STUB, not a resurrected face: the prune's
      // own invariant is that no compiled face outlives its last importer.
      expect(fs.readFileSync(mirrorOf(s, 'widget.rip'), 'utf8')).toContain('declare const uniqueWidgetName: any');
    } finally { await s.close(); }
  }, 120_000);
});

// THROUGH A BARREL, which is where the re-stub above quietly lost half its
// answer. A barrel's `export * from` names are written in the TARGET, so a
// stub built for the barrel ALONE resolves none of them — the population
// pass never hits this because it scans the whole workspace at once, and
// only the prune's single-file rebuild does. The symptom is narrow and
// nasty: accepting an auto-import through a barrel and then removing it
// takes the barrel out of candidacy, while the direct file stays offered.
describeExtended('candidacy through a barrel survives an import being removed', () => {
  const BARREL = {
    'widget.rip': 'export uniqueWidgetName = (n: number): string -> "w"\n',
    'barrel.rip': "export * from './widget.rip'\nexport barrelOwnName = (): number -> 1\n",
    'test.rip': "console.log 'x'\nfirst = uni\n",
    'package.json': '{}\n',
  };
  const AT = { line: 1, col: 11 };

  test('a name re-exported through a barrel is still offered from BOTH sources', async () => {
    const s = await openSession(BARREL);
    try {
      await awaitStub(s, 'barrel.rip');
      s.open('test.rip');
      await s.diagnostics('test.rip');
      const before = await s.completions('test.rip', AT.line, AT.col);
      expect(before.length, 'the list is live').toBeGreaterThan(0);
      // Two entries: the barrel re-exports it and widget.rip declares it.
      expect(before.filter((l) => l === 'uniqueWidgetName')).toHaveLength(2);

      s.change('test.rip', "import { uniqueWidgetName } from './barrel.rip'\nconsole.log 'x'\nfirst = uni\n");
      await s.diagnostics('test.rip');
      s.change('test.rip', "console.log 'x'\nfirst = uni\n");
      await s.diagnostics('test.rip');
      await new Promise((r) => setTimeout(r, 1500));   // the prune is backgrounded

      const after = await s.completions('test.rip', AT.line, AT.col);
      expect(after.length, 'the list is live').toBeGreaterThan(0);
      expect(after.filter((l) => l === 'uniqueWidgetName')).toHaveLength(2);
      // The pass-through name is the one that needs the star resolved, and
      // asserting the barrel's stub CONTENT is what names the defect: the
      // count above would also pass if the barrel had vanished and widget
      // were somehow offered twice.
      expect(fs.readFileSync(mirrorOf(s, 'barrel.rip'), 'utf8'))
        .toContain('declare const uniqueWidgetName: any');
    } finally { await s.close(); }
  }, 120_000);
});

// A consumer that imports a stub-populated file must get the SAME answers
// it would get with no population at all. `wrong` passes a string where the
// face declares a number, so the diagnostic under test is a real TS2345 and
// not an artifact of the fixture.
const CONSUMER = {
  'lib.rip': 'export widget = (n: number): string -> \'w\' + n\n',
  'main.rip': "import { widget } from './lib.rip'\nconsole.log widget('nope')\n",
  'package.json': '{}\n',
};
const WIDGET_USE = { line: 1, col: 13 };   // `console.log wid|get('nope')`

describeExtended('a stub never shadows the real face', () => {
  async function surfaces(s) {
    return {
      hover: await s.hover('main.rip', WIDGET_USE.line, WIDGET_USE.col),
      definitions: await s.definitions('main.rip', WIDGET_USE.line, WIDGET_USE.col),
      codes: s.codes(await s.diagnostics('main.rip')),
    };
  }

  // Both halves of the brief in one drive: the file is a stub first
  // (asserted on disk, so the test cannot pass by the stub never having
  // existed), then the import edge materializes the true face over it, and
  // all three surfaces answer at full fidelity — before the imported file
  // is ever opened, and again after.
  test('hover, go-to-definition and a real TS2345 all answer at full fidelity', async () => {
    const s = await openSession(CONSUMER);
    try {
      const stub = await awaitStub(s, 'lib.rip');
      expect(stub).toContain('export declare const widget: any;');

      s.open('main.rip');
      await s.diagnostics('main.rip');
      s.forget('main.rip');
      s.change('main.rip', "import { widget } from './lib.rip'\nconsole.log widget('nope')\n");

      const closed = await surfaces(s);
      expect(closed.hover).toContain('(n: number) => string');
      expect(closed.hover).not.toContain('any');
      expect(closed.definitions).toEqual(['lib.rip:0']);
      expect(closed.codes).toContain(2345);

      s.open('lib.rip');                       // now open it too
      await s.diagnostics('lib.rip');
      s.forget('main.rip');
      s.change('main.rip', "import { widget } from './lib.rip'\nconsole.log widget('nope')\n");
      const opened = await surfaces(s);
      expect(opened.hover).toBe(closed.hover);
      expect(opened.definitions).toEqual(closed.definitions);
      expect(opened.codes).toEqual(closed.codes);
    } finally { await s.close(); }
  }, 120_000);
});

// A stub is written from a source SCAN, so a file that does not compile
// still gets one. Left in place it would answer `any` for every use and
// swallow the unresolved-module error the importer is owed — candidacy
// buying silence, which is the one trade this feature must never make.
describeExtended('a stub never buys silence', () => {
  const BROKEN = {
    // Backticks are not a rip string: this file fails to tokenize, so the
    // closure materialization that its importer triggers cannot produce a
    // face for it.
    'broken.rip': 'export widget = (n: number): string -> `w${n}`\n',
    'main.rip': "import { widget } from './broken.rip'\nconsole.log widget('nope')\n",
    'package.json': '{}\n',
  };

  test('an importer of a .rip that does not compile still gets its TS2307', async () => {
    const s = await openSession(BROKEN);
    try {
      await awaitStub(s, 'broken.rip');
      s.open('main.rip');
      expect(s.codes(await s.diagnostics('main.rip'))).toContain(2307);
      expect(fs.existsSync(mirrorOf(s, 'broken.rip'))).toBe(false);
    } finally { await s.close(); }
  }, 90_000);
});

// Maintenance, both directions, on a file NOTHING opens or imports —
// the only state a stub is ever the live face in.
describeExtended('a stub maintains itself', () => {
  const SOLO = {
    'solo.rip': 'export solo = (): number -> 1\n',
    'app.rip': "console.log 'x'\nfirst = so\n",
    'package.json': '{}\n',
  };

  test('editing an unopened .rip replaces the stub with the full face', async () => {
    const s = await openSession(SOLO);
    try {
      s.open('app.rip');
      await s.diagnostics('app.rip');
      expect(await awaitStub(s, 'solo.rip')).toContain('export declare const solo: any;');

      s.touch('solo.rip', 'export solo = (): number -> 2\nexport extra = (): number -> 3\n');
      await new Promise((r) => setTimeout(r, 1500));
      const face = fs.readFileSync(mirrorOf(s, 'solo.rip'), 'utf8');
      expect(face).not.toContain('declare const solo');   // a real compile, not a stub
      expect(face).toContain('return 2');
      expect(await candidatesAt(s, { line: 1, col: 10 })).toContain('solo');
    } finally { await s.close(); }
  }, 90_000);

  // A file CREATED mid-session is the one you are most likely to want to
  // import next, and the startup pass never saw it.
  test('a .rip created mid-session becomes a candidate without a restart', async () => {
    const s = await openSession(SOLO);
    try {
      s.open('app.rip');
      await s.diagnostics('app.rip');
      await awaitStub(s, 'solo.rip');

      s.touch('sonar.rip', 'export sonarPing = (): number -> 7\n');   // Created on disk + watcher event
      expect(await awaitStub(s, 'sonar.rip')).toContain('export declare const sonarPing: any;');
      s.forget('app.rip');
      s.change('app.rip', "console.log 'x'\nfirst = sonarP\n");
      await s.diagnostics('app.rip');
      expect(await candidatesAt(s, { line: 1, col: 13 })).toContain('sonarPing');
    } finally { await s.close(); }
  }, 90_000);

  test('deleting an unopened .rip removes its mirror', async () => {
    const s = await openSession(SOLO);
    try {
      s.open('app.rip');
      await s.diagnostics('app.rip');
      await awaitStub(s, 'solo.rip');

      s.remove('solo.rip');
      await new Promise((r) => setTimeout(r, 1500));
      expect(fs.existsSync(mirrorOf(s, 'solo.rip'))).toBe(false);
    } finally { await s.close(); }
  }, 90_000);
});
