// The Rip language server driven over real LSP stdio — the review
// contracts pinned end-to-end:
//
//   1. STALE HOVER: while the buffer is broken, hover serves from
//      the last good compile only where coordinates verifiably align —
//      a position below an inserted line still hovers the RIGHT
//      construct (the regression a raw-offset interpretation causes:
//      it hovers whatever sits at that offset in the old text), and a
//      position on the changed line answers null.
//   2. TSGO CRASH: killing the tsgo child mid-session never wedges the
//      server — parse diagnostics keep publishing, hover keeps
//      answering (restart-once policy), requests never hang.
//   3. THE TS FACE: the virtual doc carries Rip's annotations —
//      write-site hover on an annotated declaration reads the real
//      type, an annotation violation surfaces as a TS diagnostic
//      positioned on Rip source, and annotating a legal Rip pattern
//      never CREATES a diagnostic (the the settled rule definite-assignment
//      spelling keeps hoisted read-before-assign quiet).
//
// Same availability guard as the broker suite: dependencies absent →
// loud skip; RIP_REQUIRE_TSGO (the package's canonical test script)
// makes absence fail.
import { test, expect, describe } from 'bun:test';
import path from 'node:path';
import { execSync } from 'node:child_process';

let tsgoAvailable = false;
try {
  const { tsgoBinaryPath } = await import('../src/tsgo.js');
  tsgoBinaryPath();
  tsgoAvailable = true;
} catch { /* dependencies not installed; tsgo-broker.test.js owns the loud notice */ }

const SERVER = path.resolve(import.meta.dir, '..', 'src', 'server.js');
const uri = 'file:///demo/app.rip';

// Lines chosen for the GPT repro: `greeting` on line 0, `count` on
// line 1 — after inserting a broken line at file start, the OLD offset
// of the hover position lands on `count` while the user hovers
// `greeting`.
const GOOD = 'greeting = "hello"\ncount = 42\nconsole.log greeting, count\n';

async function startServer(onDiagnostics) {
  const { LspClient } = await import('../src/tsgo.js');
  const client = new LspClient('bun', [SERVER, '--stdio'], {
    onNotification: (method, params) => {
      if (method === 'textDocument/publishDiagnostics') onDiagnostics(params);
    },
  });
  await client.request('initialize', { processId: process.pid, rootUri: 'file:///demo', capabilities: {} });
  client.notify('initialized', {});
  return client;
}

const nextDiagnostics = (published) => {
  const before = published.length;
  return async () => {
    for (let i = 0; i < 150 && published.length === before; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(published.length).toBeGreaterThan(before);
    return published[published.length - 1];
  };
};

const hoverAt = (client, line, character) =>
  client.request('textDocument/hover', { textDocument: { uri }, position: { line, character } });

describe.skipIf(!tsgoAvailable)('server over LSP stdio', () => {
  test('stale hover: aligned positions serve, shifted-context positions answer null', async () => {
    const published = [];
    const client = await startServer((p) => published.push(p));
    try {
      let wait = nextDiagnostics(published);
      client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'rip', version: 1, text: GOOD },
      });
      expect((await wait()).diagnostics).toEqual([]);

      // Break the parse by INSERTING a line at file start: every
      // construct shifts down one line.
      wait = nextDiagnostics(published);
      client.notify('textDocument/didChange', {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: 'oops = (\n' + GOOD }],
      });
      const broken = await wait();
      expect(broken.diagnostics).toHaveLength(1);
      expect(broken.diagnostics[0].source).toBe('rip');

      // The regression: hovering `greeting` at its NEW position (line 1)
      // must answer about greeting — never about `count`, which is what
      // the raw offset finds in the last-good text.
      const hover = await hoverAt(client, 1, 3);
      expect(hover).not.toBeNull();
      expect(hover.contents.value).toContain('greeting');
      expect(hover.contents.value).not.toContain('count');
      // And its range arrives in CURRENT-buffer coordinates (line 1).
      expect(hover.range.start.line).toBe(1);

      // A position on the inserted (changed) line has no aligned twin.
      expect(await hoverAt(client, 0, 1)).toBeNull();
    } finally {
      await client.stop();
    }
  }, 30000);

  test('tsgo crash: parse diagnostics keep flowing, hover recovers (restart-once), nothing wedges', async () => {
    const published = [];
    const client = await startServer((p) => published.push(p));
    try {
      let wait = nextDiagnostics(published);
      client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'rip', version: 1, text: GOOD },
      });
      expect((await wait()).diagnostics).toEqual([]);

      // Kill the tsgo child (the server's only child process) with
      // prejudice — no shutdown handshake.
      const children = execSync(`pgrep -P ${client.proc.pid}`).toString().trim().split('\n');
      expect(children.length).toBeGreaterThan(0);
      for (const pid of children) process.kill(Number(pid), 'SIGKILL');

      // Parse diagnostics never depend on tsgo: a broken edit still
      // publishes, promptly.
      wait = nextDiagnostics(published);
      client.notify('textDocument/didChange', {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: GOOD + 'oops = (\n' }],
      });
      const broken = await wait();
      expect(broken.diagnostics).toHaveLength(1);
      expect(broken.diagnostics[0].source).toBe('rip');

      // A valid edit after the crash: the restart-once policy brings
      // TS diagnostics back (the bad call maps onto .rip source again).
      wait = nextDiagnostics(published);
      client.notify('textDocument/didChange', {
        textDocument: { uri, version: 3 },
        contentChanges: [{ text: GOOD + 'bad = count.toUpperCase()\nconsole.log bad\n' }],
      });
      const recovered = await wait();
      expect(recovered.diagnostics).toHaveLength(1);
      expect(recovered.diagnostics[0].code).toBe(2339);

      // And hover answers (bounded — the request must not hang).
      const hover = await hoverAt(client, 1, 2);
      expect(hover).not.toBeNull();
      expect(hover.contents.value).toContain('count');
    } finally {
      await client.stop();
    }
  }, 30000);

  test('TS face: write-site hover reads the annotated type (the settled scope acceptance)', async () => {
    const published = [];
    const client = await startServer((p) => published.push(p));
    try {
      const wait = nextDiagnostics(published);
      client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'rip', version: 1, text: 'count: number = 42\ndouble = count * 2\nconsole.log double\n' },
      });
      expect((await wait()).diagnostics).toEqual([]);

      // Hover `count` AT ITS DECLARATION (line 0 — the write site):
      // the TS face declares `let count: number` from the annotation,
      // so the write site reads the real type.
      const atWrite = await hoverAt(client, 0, 2);
      expect(atWrite).not.toBeNull();
      expect(atWrite.contents.value).toContain('count');
      expect(atWrite.contents.value).toContain('number');
      expect(atWrite.contents.value).not.toContain('any');

      // The read site agrees, and its range lands on the .rip name.
      const atRead = await hoverAt(client, 1, 10);
      expect(atRead.contents.value).toContain('number');
      expect(atRead.range.start.line).toBe(1);
    } finally {
      await client.stop();
    }
  }, 30000);

  test('TS face: a cast reaches hover — the asserted type reads at the value (the settled scope acceptance)', async () => {
    const published = [];
    const client = await startServer((p) => published.push(p));
    try {
      const wait = nextDiagnostics(published);
      client.notify('textDocument/didOpen', {
        textDocument: {
          uri, languageId: 'rip', version: 1,
          // `raw` is any (JSON.parse) — only the cast's face bytes
          // give `items` its type, so this hover is cast-dependent.
          text: 'raw = JSON.parse("[]")\nitems = raw as string[]\nk = items.length\nconsole.log k\n',
        },
      });
      expect((await wait()).diagnostics).toEqual([]);

      const hover = await hoverAt(client, 2, 5);
      expect(hover).not.toBeNull();
      expect(hover.contents.value).toContain('string[]');
      expect(hover.range.start.line).toBe(2);
    } finally {
      await client.stop();
    }
  }, 30000);

  test('TS face: an annotation violation diagnoses on the Rip source line (the settled scope acceptance)', async () => {
    const published = [];
    const client = await startServer((p) => published.push(p));
    try {
      const wait = nextDiagnostics(published);
      client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'rip', version: 1, text: 'count: number = 42\ncount = "nope"\nconsole.log count\n' },
      });
      const { diagnostics } = await wait();
      // TS2322: string assigned to the number-annotated variable —
      // the face carries the declared type to tsgo, positioned on the
      // offending .rip line.
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].code).toBe(2322);
      expect(diagnostics[0].source).toBe('rip/ts');
      expect(diagnostics[0].range.start.line).toBe(1);
    } finally {
      await client.stop();
    }
  }, 30000);

  test('a :model schema declaration compiles in the editor — sane diagnostics, hover answers, body positions never crash', async () => {
    // The extension inherits the :model surface through the face
    // automatically (the server compiles the same compile() the DSL
    // landed in). Sane means: a callable-free model draws ZERO
    // diagnostics; a model WITH callables draws NONE either — the
    // The schema type story types callable `this` per the runtime's
    // calling conventions (the settled rule (ii)), which RETIRED the TS2683 class
    // this test used to pin; hover answers at a use site; and no
    // position inside the new syntax crashes the server.
    const published = [];
    const client = await startServer((p) => published.push(p));
    try {
      let wait = nextDiagnostics(published);
      // (`console.log User` — the the settled rule (i) module marker makes a
      // schema file a module, so a DEAD demo binding would draw the
      // true 6133 unused hint; the fixture consumes what it binds)
      const fixture = [
        'analytics = {query: (sql) -> sql}',
        'User = schema :model, on: analytics',
        '  name!  string',
        '  email! email @unique',
        '  @timestamps',
        '  @belongs_to Organization',
        '  @idStart 5000',
        'console.log User',
        '',
      ].join('\n');
      client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'rip', version: 1, text: fixture },
      });
      // a callable-free model contributes NOTHING (no diagnostic
      // names a directive, a field, the attrs, or the on: option)
      expect((await wait()).diagnostics).toEqual([]);
      // hover at a USE site of the model binding answers from tsgo
      const atUse = await hoverAt(client, 7, 13);
      expect(atUse).not.toBeNull();
      expect(atUse.contents.value.length).toBeGreaterThan(0);
      // positions inside the model body (fields, directives, the on:
      // option) answer or decline — never crash
      for (const [line, ch] of [[1, 25], [2, 3], [4, 4], [5, 15], [6, 3]]) {
        await hoverAt(client, line, ch);
      }

      // With hook/scope callables the model draws NO diagnostics: the
      // The schema type story injects `this: User` / `this: SchemaQuery<…>`
      // parameters into the face (the settled rule (ii)), so the TS2683 class this
      // test used to pin is retired — `@name` inside the hook and
      // `@where(...)` inside the scope both type-check.
      wait = nextDiagnostics(published);
      const withCallables = [
        'analytics = {query: (sql) -> sql}',
        'User = schema :model, on: analytics',
        '  name!   string',
        '  active? boolean',
        '  beforeSave: -> @name',
        '  @scope :live, -> @where(active: true)',
        'console.log User',
        '',
      ].join('\n');
      client.notify('textDocument/didChange', {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: withCallables }],
      });
      const { diagnostics } = await wait();
      expect(diagnostics.filter((d) => d.code === 2683)).toEqual([]);
      expect(diagnostics).toEqual([]);
      const still = await hoverAt(client, 6, 13);
      expect(still).not.toBeNull();
    } finally {
      await client.stop();
    }
  }, 30000);

  test('a component declaration never crashes the editor face', async () => {
    // The face boundary: component classes carry no
    // TS-only member declares yet (the face owns the type story), so
    // the editor may draw semantic diagnostics on member accesses
    // (`this.count` on an untyped class — the TS2339/TS2551 family).
    // The acceptance bar THIS wave: the face stays REAL TypeScript
    // (no TS1xxx syntax diagnostics), every position answers or
    // declines, and the server never crashes.
    const published = [];
    const client = await startServer((p) => published.push(p));
    try {
      const wait = nextDiagnostics(published);
      const fixture = [
        'Counter = component',
        '  count := 0',
        '  @step := 1',
        '  total ~= count * 2',
        '  onClick = (e) ->',
        '    count += step',
        '  render',
        '    div.card',
        '      h1 "Counter"',
        '      = count',
        '      button @click, disabled: count > 5',
        '        "Step"',
        'console.log Counter',
        '',
      ].join('\n');
      client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'rip', version: 1, text: fixture },
      });
      const { diagnostics } = await wait();
      // The face parses as TypeScript — no syntax-class diagnostics.
      expect(diagnostics.filter((d) => typeof d.code === 'number' && d.code < 2000)).toEqual([]);
      // Hover across the declaration, members, the render DSL, and a
      // use site: every position answers or declines, never crashes.
      for (const [line, ch] of [[0, 2], [1, 3], [3, 3], [4, 3], [7, 5], [9, 8], [10, 14], [12, 13]]) {
        await hoverAt(client, line, ch);
      }
      const atUse = await hoverAt(client, 12, 13);
      expect(atUse).not.toBeNull();
    } finally {
      await client.stop();
    }
  }, 30000);

  test('the dynamic render layer never crashes the editor face', async () => {
    // Block factories, loops, `<=>`, refs, and transitions emit whole
    // new generated shapes (factory methods, owner-frame calls) — the
    // face must stay REAL TypeScript (no TS1xxx), every position must
    // answer or decline, and the server must survive edits that flip
    // a construct between valid and invalid.
    const published = [];
    const client = await startServer((p) => published.push(p));
    try {
      const wait = nextDiagnostics(published);
      const fixture = [
        'Roster = component',                    // 0
        '  items := [{id: 1, name: "a"}]',       // 1
        '  vis := true',                         // 2
        '  sel := ""',                           // 3
        '  el := null',                          // 4
        '  render',                              // 5
        '    section',                           // 6
        '      if vis',                          // 7
        '        div ~fade',                     // 8
        '          "shown"',                     // 9
        '      else',                            // 10
        '        p "hidden"',                    // 11
        '      ul',                              // 12
        '        for item, idx in items',        // 13
        '          li key: item.id',             // 14
        '            = item.name',               // 15
        '      input type: "text", value <=> sel', // 16
        '      div ref: el',                     // 17
        '        "anchored"',                    // 18
        'console.log Roster',                    // 19
        '',
      ].join('\n');
      client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'rip', version: 1, text: fixture },
      });
      const { diagnostics } = await wait();
      expect(diagnostics.filter((d) => typeof d.code === 'number' && d.code < 2000)).toEqual([]);
      // Hover across the dynamic constructs: the conditional head, the
      // transition line, the loop head, the key, the bind, the ref.
      for (const [line, ch] of [[7, 9], [8, 12], [13, 14], [14, 16], [16, 30], [17, 15], [19, 13]]) {
        await hoverAt(client, line, ch);
      }
      // An edit that makes a dynamic construct INVALID (a transition
      // on a static element — a compile rejection): the server keeps
      // serving the stale face and answers positions, never crashes.
      const wait2 = nextDiagnostics(published, 2);
      client.notify('textDocument/didChange', {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: fixture.replace('div ref: el', 'div ~slide, ref: el') }],
      });
      await wait2();
      const after = await hoverAt(client, 0, 2);
      expect(after !== undefined).toBe(true);
    } finally {
      await client.stop();
    }
  }, 30000);

  test('a composed component pair never crashes the editor face', async () => {
    // Composition (child components, slot, extends, offer/accept)
    // emits the child protocol and rest machinery — the face must
    // stay REAL TypeScript (no TS1xxx), every position must answer or
    // decline, and the server must survive an edit that makes a
    // composition construct invalid (a second slot — a compile
    // rejection).
    const published = [];
    const client = await startServer((p) => published.push(p));
    try {
      const wait = nextDiagnostics(published);
      const fixture = [
        'Card = component',                     // 0
        '  @title := "t"',                      // 1
        '  render',                             // 2
        '    div.card',                         // 3
        '      = @title',                       // 4
        '      slot',                           // 5
        'Btn = component extends button',       // 6
        '  @label := "go"',                     // 7
        '  render',                             // 8
        '    button',                           // 9
        '      = @label',                       // 10
        'App = component',                      // 11
        '  offer theme := "dark"',              // 12
        '  name := "n"',                        // 13
        '  onPick = (e) ->',                    // 14
        '    name = e.detail',                  // 15
        '  render',                             // 16
        '    section',                          // 17
        '      Card title: name, @pick: @onPick', // 18
        '        p "projected"',                // 19
        '      Btn label: "x", disabled: true', // 20
        'console.log App',                      // 21
        '',
      ].join('\n');
      client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'rip', version: 1, text: fixture },
      });
      const { diagnostics } = await wait();
      expect(diagnostics.filter((d) => typeof d.code === 'number' && d.code < 2000)).toEqual([]);
      // Hover across the composition surface: the slot, the extends
      // header, the offered member, the child positions, a use site.
      for (const [line, ch] of [[0, 2], [5, 7], [6, 25], [12, 8], [18, 7], [18, 18], [20, 7], [21, 13]]) {
        await hoverAt(client, line, ch);
      }
      // An edit that makes composition INVALID (a second slot — the
      // #166 rejection): the server keeps serving the stale face.
      const wait2 = nextDiagnostics(published, 2);
      client.notify('textDocument/didChange', {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: fixture.replace('      slot\n', '      slot\n      slot\n') }],
      });
      await wait2();
      const after = await hoverAt(client, 0, 2);
      expect(after !== undefined).toBe(true);
    } finally {
      await client.stop();
    }
  }, 30000);

  test('the component face types members — hover on every member kind, ONE real diagnostic on the render expression, no TS2339 noise', async () => {
    // The component face: component classes now carry
    // TS-only member declares, so member accesses type instead of
    // drawing TS2339-class noise — and a REAL violation inside a
    // render block lands exactly on the user's expression span (the
    // render rewrite mints tokens; positions must reach user source).
    const published = [];
    const client = await startServer((p) => published.push(p));
    try {
      const wait = nextDiagnostics(published);
      const fixture = [
        'Card = component',                 // 0
        '  @title: string',                 // 1
        '  @size: number := 1',             // 2
        '  count := 0',                     // 3
        '  total ~= count * 2',             // 4
        '  accept theme',                   // 5
        '  onClick = (e) ->',               // 6
        '    count += 1',                   // 7
        '  render',                         // 8
        '    div.card',                     // 9
        '      = @title.toUpperCase()',     // 10
        '      = @size.toUpperCase()',      // 11 ← the planted TS2339 (number)
        '      button @click',              // 12
        'App = component',                  // 13
        '  name := "n"',                    // 14
        '  render',                         // 15
        '    section',                      // 16
        '      Card title: name, size: 3',  // 17
        'console.log Card, App',            // 18
        '',
      ].join('\n');
      client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'rip', version: 1, text: fixture },
      });
      const { diagnostics } = await wait();
      // Exactly the planted violation — nothing else (the member
      // declares remove the TS2339 noise class; the minted `_init`
      // param's unused hint drops with the exact-span rendering rule).
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].code).toBe(2339);
      expect(diagnostics[0].range.start.line).toBe(11);
      expect(diagnostics[0].range.start.character).toBe(14); // `toUpperCase` in source
      // Member hovers answer the container conventions.
      const state = await hoverAt(client, 3, 3);
      expect(state.contents.value).toContain('count');
      // Unannotated members with literal initializers infer their
      // syntactic type  — was `value: any`.
      expect(state.contents.value).toContain('value: number');
      const typedProp = await hoverAt(client, 1, 4);
      expect(typedProp.contents.value).toContain('value: string');
      const computed = await hoverAt(client, 4, 3);
      expect(computed.contents.value).toContain('readonly value');
      // A member READ inside a render block hovers the same container
      // (the the settled rule write-site question never arises — members are
      // declared class properties, typed at every site).
      const renderRead = await hoverAt(client, 10, 9);
      expect(renderRead.contents.value).toContain('value: string');
      // The accept member is the honest cross-component boundary: the
      // offered container's type is not knowable statically — any.
      const accepted = await hoverAt(client, 5, 10);
      expect(accepted.contents.value).toContain('theme: any');
    } finally {
      await client.stop();
    }
  }, 30000);

  test('prop completions and prop-key hover at a child-component call site', async () => {
    const published = [];
    const client = await startServer((p) => published.push(p));
    try {
      const wait = nextDiagnostics(published);
      const fixture = [
        'Chip = component',                 // 0
        '  @label: string := "c"',          // 1
        '  @width: number := 1',            // 2
        '  render',                         // 3
        '    span.chip',                    // 4
        '      = @label',                   // 5
        'App = component',                  // 6
        '  render',                         // 7
        '    div',                          // 8
        '      Chip label: "x"',            // 9
        'console.log Chip, App',            // 10
        '',
      ].join('\n');
      client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'rip', version: 1, text: fixture },
      });
      await wait();
      // Completions at the prop key offer the child's remaining props
      // (`label` is already given; `__bind_*` slots are scrubbed as
      // compiler namespace).
      const completion = await client.request('textDocument/completion', {
        textDocument: { uri }, position: { line: 9, character: 13 },
      });
      const labels = (completion?.items ?? completion ?? []).map((i) => i.label);
      expect(labels.some((l) => l.startsWith('width'))).toBe(true);
      expect(labels.some((l) => l.startsWith('__bind_'))).toBe(false);
      // The prop key itself hovers the prop's container type.
      const keyHover = await hoverAt(client, 9, 12);
      expect(keyHover.contents.value).toContain('label');
      expect(keyHover.contents.value).toContain('string');
      // Teeth: a wrong-typed prop at the call site diagnoses on the
      // Rip line that wrote it.
      const wait2 = nextDiagnostics(published);
      client.notify('textDocument/didChange', {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: fixture.replace('Chip label: "x"', 'Chip label: 5') }],
      });
      const { diagnostics } = await wait2();
      expect(diagnostics.some((d) => d.code === 2322 && d.range.start.line === 9)).toBe(true);

      // A FRESH key mid-typing (the GPT addendum, F4): boolean
      // shorthand lowers `w` into the ctor object, and its derived
      // exact row maps the completion — remaining props offer at the
      // word and one past it, and the excess-property error lands on
      // the user's own `w` bytes while they type.
      const wait3 = nextDiagnostics(published);
      client.notify('textDocument/didChange', {
        textDocument: { uri, version: 3 },
        contentChanges: [{ text: fixture.replace('Chip label: "x"', 'Chip label: "x", w') }],
      });
      const d3 = (await wait3()).diagnostics;
      expect(d3.some((d) => d.code === 2353 && d.range.start.line === 9)).toBe(true);
      for (const ch of [23, 24]) { // on `w` and one past it
        const fresh = await client.request('textDocument/completion', {
          textDocument: { uri }, position: { line: 9, character: ch },
        });
        const freshLabels = (fresh?.items ?? fresh ?? []).map((i) => i.label);
        expect(freshLabels.some((l) => l.startsWith('width'))).toBe(true);
      }
      // The recorded boundary: a BARE position after a trailing comma
      // has no source bytes to map (cover-based cursor mapping is
      // deliberately rejected — a misplaced completion context is
      // worse than none), so it answers empty. Pinned as the honest
      // edge, not claimed.
      const wait4 = nextDiagnostics(published);
      client.notify('textDocument/didChange', {
        textDocument: { uri, version: 4 },
        contentChanges: [{ text: fixture.replace('Chip label: "x"', 'Chip label: "x", ') }],
      });
      await wait4();
      const bare = await client.request('textDocument/completion', {
        textDocument: { uri }, position: { line: 9, character: 23 }, // after `, ` — no bytes
      });
      expect((bare?.items ?? bare ?? []).length).toBe(0);
    } finally {
      await client.stop();
    }
  }, 30000);

  test('a declared @children prop is a CLEAN legal component in the editor (the GPT addendum, F1)', async () => {
    const published = [];
    const client = await startServer((p) => published.push(p));
    try {
      const wait = nextDiagnostics(published);
      const fixture = [
        'Child = component',        // 0
        '  @children: string',      // 1
        '  render',                 // 2
        '    div "x"',              // 3
        'console.log Child',        // 4
        '',
      ].join('\n');
      client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'rip', version: 1, text: fixture },
      });
      // Was TS2300 ×4 + TS2717 ×2 through the duplicate children keys.
      expect((await wait()).diagnostics).toEqual([]);
      const hover = await hoverAt(client, 1, 4);
      expect(hover.contents.value).toContain('value: string');
    } finally {
      await client.stop();
    }
  }, 30000);

  test('the #124 handler story: explicit bindings navigate and rename; the bare directive declines definition and REFUSES rename', async () => {
    const published = [];
    const client = await startServer((p) => published.push(p));
    try {
      const explicitOnly = [
        'Card = component',                   // 0
        '  count := 0',                       // 1
        '  onClick = (e) ->',                 // 2
        '    count += 1',                     // 3
        '  render',                           // 4
        '    div.card',                       // 5
        '      button @click: @onClick',      // 6
        'console.log Card',                   // 7
        '',
      ].join('\n');
      let wait = nextDiagnostics(published);
      client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'rip', version: 1, text: explicitOnly },
      });
      await wait();
      // Definition on the explicit handler reference lands on the
      // method declaration.
      const def = await client.request('textDocument/definition', {
        textDocument: { uri }, position: { line: 6, character: 24 },
      });
      expect(def?.[0]?.range?.start?.line).toBe(2);
      // Rename through the explicit reference: both spellings edit.
      const rename = await client.request('textDocument/rename', {
        textDocument: { uri }, position: { line: 2, character: 4 }, newName: 'onPress',
      });
      const edits = rename?.changes?.[uri] ?? [];
      expect(edits).toHaveLength(2);
      expect(edits.some((e) => e.range.start.line === 6)).toBe(true);

      // A BARE `@click` derives the handler name — nothing in source
      // spells `onClick` at the directive, so a rename touching the
      // minted reference REFUSES whole (the budget: never a silent broken
      // rename; the compile rejection would name the missing method
      // loudly if it could apply), and definition on the directive
      // declines rather than landing on scaffolding.
      wait = nextDiagnostics(published);
      client.notify('textDocument/didChange', {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: explicitOnly.replace('    div.card\n', '    div.card\n      button @click\n') }],
      });
      await wait();
      let refused = null;
      try {
        await client.request('textDocument/rename', {
          textDocument: { uri }, position: { line: 2, character: 4 }, newName: 'onPress',
        });
      } catch (err) {
        refused = err;
      }
      expect(refused).not.toBeNull();
      expect(String(refused.message)).toContain('generated-only bytes');
      const defAtDirective = await client.request('textDocument/definition', {
        textDocument: { uri }, position: { line: 6, character: 15 },
      });
      expect(defAtDirective === null || (Array.isArray(defAtDirective) && defAtDirective.length === 0)).toBe(true);
    } finally {
      await client.stop();
    }
  }, 30000);

  test('model instance types reach the editor — field hover, query completions, a field-type violation on the Rip line', async () => {
    // The three commissioned scenarios, all through the standing
    // broker with ZERO extension changes: the face now carries the
    // schema type story (intrinsics + aliases + the binding cast), so
    // tsgo answers model questions like class questions.
    const published = [];
    const client = await startServer((p) => published.push(p));
    try {
      const wait = nextDiagnostics(published);
      // `find` answers Promise<User | null>, so the fixture narrows
      // before the field read — the idiomatic shape (an unnarrowed
      // read draws TS18047 under strict configs, plain-TS parity).
      const fixture = [
        'User = schema :model',        // 0
        '  name!   string',            // 1
        '  active? boolean',           // 2
        '  @timestamps',               // 3
        'load = ->',                   // 4
        '  u = await User.find(1)',    // 5
        '  if u',                      // 6
        '    u.name',                  // 7
        'fix = (u: User) ->',          // 8
        '  u.name = 5',                // 9
        'console.log load, fix',       // (the module marker makes dead bindings draw true 6133 hints)
        '',
      ].join('\n');
      client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'rip', version: 1, text: fixture },
      });

      // SCENARIO 3 first (diagnostics arrive with the open): the
      // type-violating assignment to a declared field diagnoses as
      // TS2322 ON the Rip line that wrote it — and nothing else in
      // the fixture draws anything.
      const { diagnostics } = await wait();
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0].code).toBe(2322);
      expect(diagnostics[0].range.start.line).toBe(9);

      // SCENARIO 1: hover a model instance FIELD — the narrowed read
      // in `u.name` (line 7, on `name`) answers the declared type.
      const fieldHover = await hoverAt(client, 7, 7);
      expect(fieldHover).not.toBeNull();
      expect(fieldHover.contents.value).toContain('name');
      expect(fieldHover.contents.value).toContain('string');

      // SCENARIO 2: complete a QUERY METHOD — member position on
      // `User.` (line 5, on `find`) offers the ModelSchema surface.
      const completion = await client.request('textDocument/completion', {
        textDocument: { uri }, position: { line: 5, character: 17 },
      });
      const labels = (completion?.items ?? []).map((i) => i.label);
      for (const expected of ['find', 'where', 'create', 'withDeleted', 'unscoped']) {
        expect(labels, `completion should offer '${expected}'`).toContain(expected);
      }
      // …and the instance side completes too: `u.` members include
      // declared fields, the implicit columns, and the persistence
      // surface (the member position on line 7's `name`).
      const instCompletion = await client.request('textDocument/completion', {
        textDocument: { uri }, position: { line: 7, character: 6 },
      });
      const instLabels = (instCompletion?.items ?? []).map((i) => i.label);
      // (`active?` — tsgo labels optional properties with their marker)
      for (const expected of ['name', 'active?', 'createdAt', 'save', 'toJSON']) {
        expect(instLabels, `instance completion should offer '${expected}'`).toContain(expected);
      }
    } finally {
      await client.stop();
    }
  }, 30000);

  test('the settled rule evolving-let UX: unannotated locals stay quiet like plain TS — the unused hint carries the Unnecessary tag, reads infer, violations error (the owner fixture)', async () => {
    const published = [];
    const client = await startServer((p) => published.push(p));
    try {
      // The owner's fixture: `main: ->` is a statement-level implicit-
      // object member (the the settled rule sibling machinery keeps a function-valued
      // `name:` line an object member — only type-shaped values claim as
      // forwards), so the body is an ordinary method scope. `total` is
      // unannotated and rides evolving-let; its only use is the write
      // that the implicit return consumes, so tsgo reports TS6133
      // ("declared but its value is never read") at hint severity —
      // exactly what plain TS reports for `let total; return total = …`.
      const fixture = 'main: ->\n  count: number = 0\n  ratio: number = 3.14\n\n  total = count + ratio\n';
      let wait = nextDiagnostics(published);
      client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'rip', version: 1, text: fixture },
      });
      const { diagnostics } = await wait();
      // Nothing may render as an underline: the one hint carries the
      // Unnecessary tag (VS Code fades the name — plain-TS rendering),
      // and no error/warning-severity diagnostic exists.
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].code).toBe(6133);
      expect(diagnostics[0].severity).toBe(4);
      expect(diagnostics[0].tags).toEqual([1]);
      expect(diagnostics[0].range.start.line).toBe(4);

      // With NO reads anywhere, write-site hover answers `any` — tsgo's
      // own quickinfo for an evolving let with nothing to evolve from,
      // identical to plain TS; the enrichment finds no qualifying
      // reference and presents the original unchanged.
      const atWrite = await hoverAt(client, 4, 3);
      expect(atWrite.contents.value).toContain('any');

      // A read consumes `total`: the hint disappears entirely, the
      // read site hovers the inferred number — and the WRITE site now
      // presents it too (the owner-directed enrichment: quickinfo at
      // the first read reference, a real tsgo answer, never invented).
      wait = nextDiagnostics(published);
      client.notify('textDocument/didChange', {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: fixture + '  total.toFixed(2)\n' }],
      });
      expect((await wait()).diagnostics).toEqual([]);
      const atRead = await hoverAt(client, 5, 3);
      expect(atRead.contents.value).toContain('number');
      expect(atRead.contents.value).not.toContain('any');
      const atWriteEnriched = await hoverAt(client, 4, 3);
      expect(atWriteEnriched.contents.value).toContain('let total: number');
      expect(atWriteEnriched.contents.value).not.toContain('any');
      // The hover range still lands on the WRITE site's Rip span.
      expect(atWriteEnriched.range.start.line).toBe(4);

      // Inference has teeth: a type-violating use errors, positioned.
      wait = nextDiagnostics(published);
      client.notify('textDocument/didChange', {
        textDocument: { uri, version: 3 },
        contentChanges: [{ text: fixture + '  total.toUpperCase()\n' }],
      });
      const violated = await wait();
      expect(violated.diagnostics).toHaveLength(1);
      expect(violated.diagnostics[0].code).toBe(2339);
      expect(violated.diagnostics[0].severity).toBe(1);
      expect(violated.diagnostics[0].range.start.line).toBe(5);
    } finally {
      await client.stop();
    }
  }, 30000);

  test('write-site enrichment boundary: an explicit `any` annotation stays any', async () => {
    const published = [];
    const client = await startServer((p) => published.push(p));
    try {
      // The user DECLARED any: reads answer `any` too (no evolving —
      // the annotation pins the type), so the enrichment's reference
      // probe finds no different declaration type and presents tsgo's
      // original answer. The annotation governs; nothing narrows it.
      const wait = nextDiagnostics(published);
      client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'rip', version: 1, text: 'flag: any\nflag = 1 + 2\nout = flag\n' },
      });
      await wait();
      const atWrite = await hoverAt(client, 1, 1);
      expect(atWrite.contents.value).toContain('let flag: any');
    } finally {
      await client.stop();
    }
  }, 30000);

  test('TS face: annotating a legal hoisted pattern draws no diagnostic (the settled rule — the TS2454 class stays quiet)', async () => {
    const published = [];
    const client = await startServer((p) => published.push(p));
    try {
      // Both review repros in one buffer: a bare-forward read before
      // its assignment, and a conditional-assign-then-read. Legal Rip
      // (hoisted reads yield undefined) — the annotation must add
      // checking, never noise; the face's `let y!: T` spelling keeps
      // definite-assignment analysis out of it.
      const text = 'y: number\nz = y\ny = 1\nflag = z == null\nw: number\nif flag\n  w = 2\nout = w\nconsole.log out\n';
      const wait = nextDiagnostics(published);
      client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'rip', version: 1, text },
      });
      expect((await wait()).diagnostics).toEqual([]);

      // The declared type still checks: violate `y: number` and the
      // TS2322 arrives on the offending .rip line.
      const wait2 = nextDiagnostics(published);
      client.notify('textDocument/didChange', {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: text + 'y = "nope"\n' }],
      });
      const { diagnostics } = await wait2();
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].code).toBe(2322);
      expect(diagnostics[0].range.start.line).toBe(9);
    } finally {
      await client.stop();
    }
  }, 30000);
});
