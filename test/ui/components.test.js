//  acceptance: component declarations, the
// member model, and the static render DSL.
//
//   - the grammar/lexer surface: COMPONENT/RENDER keywords, the
//     context-sensitive offer/accept classification, the render-block
//     scan context and rewrite pass
//   - the member model: the seven spellings lowering into _init(props)
//     in the order, member unwrap (the (1) component-scope twin),
//     lifecycle hooks, owner-frame effects
//   - the parse-time defect layer: #121 (uncategorized body
//     statements), #122 (duplicate render), #123 (duplicate members),
//     #127 (offer shapes), plus the new loud classes (#140 bound
//     effects, non-function hooks)
//   - the static render DSL with the #124/#125 fork implementations;
//     dynamic constructs and composition reject loudly
//   - sexpr spot checks where the corpus
//     stream tier cannot carry the source; the LINE-level byte tier
//     (whole-file parity is structurally unavailable — static __props
//     and method indentation); paired-behavioral over the recording
//     DOM (both compilers' output mounted, DOM streams compared)
//   - delivery: the component structural trigger, mode parity,
//     zero-cost
import { test, expect, describe } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import parser from '../../src/parser.js';
import { makeParserLexer, tokenize } from '../../src/lexer.js';
import { emit } from '../../src/emitter.js';
import { compile as fullCompile } from '../../src/compile.js';
import { installRecordingDOM, serialize } from '../support/recording-dom.js';

parser.lexer = makeParserLexer();

const compile = (src, opts = {}) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  return emit(r, { source: src, ...opts });
};

const parseFails = (src) => {
  const r = parser.parse(src);
  expect(r.sexpr).toBeNull();
  expect(r.diagnostics).not.toHaveLength(0);
};

// Every emitter rejection must be POSITIONED (carry a real span).
const emitFails = (src, pattern) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  let err = null;
  try {
    emit(r, { source: src });
  } catch (e) {
    err = e;
  }
  expect(err).not.toBeNull();
  expect(err.message).toMatch(pattern);
  expect(typeof err.start).toBe('number');
  expect(err.end).toBeGreaterThanOrEqual(err.start);
  return err;
};

// Rewrite-pass rejections throw from tokenize carrying offset spans
// (the lexer convention — compile() positions them path:line:col).
const lexFails = (src, pattern) => {
  let err = null;
  try {
    tokenize(src);
  } catch (e) {
    err = e;
  }
  expect(err).not.toBeNull();
  expect(err.message).toMatch(pattern);
  expect(typeof err.start).toBe('number');
  expect(err.end).toBeGreaterThanOrEqual(err.start);
  return err;
};

const kinds = (src) => tokenize(src).tokens.map((t) => t.kind);

// Tier 1 declare-in-place is a SANCTIONED divergence from: the compiler
// declares straight-line locals at their first write. unplaced()
// erases declaration placement from BOTH sides — hoist lines drop,
// in-place declarations become bare assignments — so these
// tests keep pinning the feature bytes they exist for.
const unplaced = (code) => code
  .replace(/^[ \t]*let [A-Za-z_$][\w$]*(, [A-Za-z_$][\w$]*)*;\n\n?/gm, '')
  .replace(/^([ \t]*)let ([A-Za-z_$][\w$]*)( = )/gm, '$1$2$3');

// ════════════════════════════════════════════════════════════════════
// The grammar/lexer surface
// ════════════════════════════════════════════════════════════════════

describe('the component surface: keywords and context', () => {
  test('`component` and `render` are keywords; property/key positions stay legal', () => {
    expect(compile('x.render()').code).toBe('x.render();');
    expect(compile('x.component').code).toBe('x.component;');
    expect(compile('o = { render: 1, component: 2 }').code).toBe('let o = {render: 1, component: 2};');
  });

  test('offer/accept classify as keywords ONLY inside component bodies', () => {
    // Outside: plain identifiers, the bare-call reading.
    expect(kinds('offer theme')).toEqual(['IDENTIFIER', 'CALL_START', 'IDENTIFIER', 'CALL_END']);
    expect(kinds('accept locale')).toEqual(['IDENTIFIER', 'CALL_START', 'IDENTIFIER', 'CALL_END']);
    // Inside a component body: real tokens.
    const inside = kinds('C = component\n  offer theme := 1\n  accept locale\n  render\n    div "x"');
    expect(inside).toContain('OFFER');
    expect(inside).toContain('ACCEPT');
    // Inside the extends form too (the walk spans it).
    expect(kinds('C = component extends button\n  offer theme := 1\n  render\n    button "x"')).toContain('OFFER');
  });

  test('offer inside a nested block of a component parses only as a body line (grammar rejects elsewhere)', () => {
    parseFails('C = component\n  save = ->\n    offer theme := 1\n  render\n    div "x"');
  });

  test('an earlier CLOSED component never poisons later code — offer/accept stay identifiers outside every component body', () => {
    // The backward walk credits only the word's ENCLOSING chain (new
    // depth minimums), never the INDENT of a sibling block that
    // already closed — an earlier component must not turn ordinary
    // identifiers into keywords for the rest of the file.
    const componentFirst = 'A = component\n  x := 1\n  render\n    div "a"\n\nhandleRequest = (req) ->\n  accept = req.headers.accept\n';
    expect(compile(componentFirst).code).toContain('(accept = req.headers.accept);');
    // Param and function-body positions after a component.
    expect(compile('A = component\n  x := 1\n  render\n    div "a"\n\nnegotiate = (offer) ->\n  offer + 1\n').code)
      .toContain('negotiate = function(offer)');
    // Class methods after a component.
    expect(compile('A = component\n  x := 1\n  render\n    div "a"\n\nclass Broker\n  take: (accept) ->\n    accept\n').code)
      .toContain('take(accept)');
    // Module level after a component: the bare-call reading.
    expect(compile('A = component\n  x := 1\n  render\n    div "a"\naccept "plain"\n').code)
      .toContain('accept("plain");');
    // ORDER-INDEPENDENCE: the same program compiles with the function
    // above or below the component, to the same function bytes.
    const functionFirst = 'handleRequest = (req) ->\n  accept = req.headers.accept\n\nA = component\n  x := 1\n  render\n    div "a"\n';
    const fnBytes = (code) => code.match(/handleRequest = function[\s\S]*?\n\};/)[0];
    expect(fnBytes(compile(componentFirst).code)).toBe(fnBytes(compile(functionFirst).code));
    // Inside a LATER component in the same file they are still keywords.
    const twoComponents = 'A = component\n  x := 1\n  render\n    div "a"\n\nB = component\n  offer theme := 1\n  render\n    div "b"\n';
    expect(compile(twoComponents).code).toContain("setContext('theme', this.theme);");
  });

  test('the offer/accept sexpr is \'s exact shape', () => {
    const r = parser.parse('C = component\n  offer theme := 1\n  accept locale\n  render\n    div "x"');
    expect(r.diagnostics).toEqual([]);
    const body = r.sexpr[1][2][2]; // program → assign → component → block
    expect(JSON.stringify(body[1])).toBe('["offer",["state","theme","1"]]');
    expect(JSON.stringify(body[2])).toBe('["accept","locale"]');
  });

  test('render scan context: tight #word is id syntax, spaced # word stays a comment', () => {
    const { code } = compile('C = component\n  render\n    div#main "x"\n');
    expect(code).toContain("this._el0.id = 'main';");
    // A line-start tight #word mints an implicit div with that id.
    const idLine = compile('C = component\n  render\n    #main\n      "kid"\n').code;
    expect(idLine).toContain("this._el0.id = 'main';");
    // Spaced # is a comment — inside render bodies too.
    const commented = compile('C = component\n  render\n    div "x" # a note\n').code;
    expect(commented).toContain('createTextNode("x")');
    expect(commented).not.toContain('a note');
  });

  test('render scan context: hyphenated class chains are ONE class name', () => {
    const { code } = compile('C = component\n  render\n    .counter-display "x"\n');
    expect(code).toContain("this._el0.className = 'counter-display';");
  });

  test('a #id merged into a CLASS segment splits back out ', () => {
    const { code } = compile('C = component\n  render\n    div.card#main "x"\n');
    expect(code).toContain("this._el0.id = 'main';");
    expect(code).toContain("this._el0.className = 'card';");
  });

  test('a line-leading dot inside render is a new element, never a chain continuation', () => {
    const { code } = compile('C = component\n  render\n    .card\n      "kid"\n');
    expect(code).toContain("document.createElement('div')");
    expect(code).toContain("this._el0.className = 'card';");
  });

  test('the event-modifier spelling stays a loud parse rejection ', () => {
    parseFails('C = component\n  save = -> 1\n  render\n    button @click.prevent: @save\n');
  });

  test('`<=>` lexes as ONE token and rewrites to the `__bind_x__:` pair inside render; elsewhere it stays a loud parse rejection', () => {
    // Outside render the BIND token survives the rewrite — no grammar
    // home, so it rejects at parse.
    expect(kinds('a <=> b')).toContain('BIND');
    parseFails('a <=> b');
    // Inside render the rewrite renames the attribute key in place.
    const toks = tokenize('C = component\n  name := ""\n  render\n    input value <=> name\n').tokens;
    expect(toks.some((t) => t.value === '__bind_value__')).toBe(true);
    expect(toks.some((t) => t.kind === 'BIND')).toBe(false);
    // A non-pair left neighbor keeps the BIND token — loud at parse.
    parseFails('C = component\n  name := ""\n  render\n    input "v" <=> name\n');
  });

  test('a component body requires an INDENT block; the bare keyword rejects at parse', () => {
    parseFails('Card = component');
    parseFails('x = render');
  });

  test('the header scan is line-bounded: a `;`-separated statement after a component header line never credits it', () => {
    // `B = component` must sit alone on its header line (the grammar
    // wants INDENT next); a `;`-joined statement whose own block
    // follows is a DIFFERENT header — its offer/accept stay
    // identifiers.
    const src = 'x = 1; helper = (accept) ->\n  accept + 1\n';
    expect(compile(src).code).toContain('helper = function(accept)');
  });

  test('`offer` inside a component METHOD is a parse rejection ', () => {
    parseFails('C = component\n  save = ->\n    offer 1\n  render\n    div "x"');
  });
});

describe('typed and optional props', () => {
  test('`@size: number` is a REQUIRED typed prop — \'s lowering, the annotation recorded for M12-E', () => {
    const { code } = compile('C = component\n  @size: number\n  render\n    div "x"\n');
    expect(code).toContain("static __props = ['size'];");
    expect(code).toContain('this.size = __state(props.__bind_size__ ?? props.size);');
  });

  test('`@size: number = 5` is a typed plain PUBLIC field; `@size: number := 5` a typed state prop', () => {
    expect(compile('C = component\n  @size: number = 5\n  render\n    div "x"\n').code)
      .toContain('this.size = props.size ?? 5;');
    expect(compile('C = component\n  @size: number := 5\n  render\n    div "x"\n').code)
      .toContain('this.size = __state(props.__bind_size__ ?? props.size ?? 5);');
  });

  test('a PRIVATE bare typed line has no member reading and rejects ', () => {
    emitFails('C = component\n  size: number\n  render\n    div "x"\n', /matches no category/);
  });

  test('`@name? := "anon"` — an optional prop WITH a default: \'s exact lowering, the marker recorded side-band', () => {
    const src = 'C = component\n  @name? := "anon"\n  render\n    div "x"\n';
    const { code } = compile(src);
    expect(code).toContain('this.name = __state(props.__bind_name__ ?? props.name ?? "anon");');
    expect(code).toContain("static __props = ['name'];");
    // The marker's span reaches RoleStore (the side-band role —
    //  type story reads it).
    const r = parser.parse(src);
    const out = emit(r, { source: src });
    const decl = r.sexpr[1][2][2][1];
    const id = out.stores.idOf(decl);
    const role = out.stores.role(id, 'optionalMarker');
    expect(role).not.toBeNull();
    expect(src.slice(role.sourceStart, role.sourceEnd)).toBe('?');
  });

  test('the OPT_MARKER lexing never disturbs the postfix existence check', () => {
    expect(compile('x = 1\ny = x?\n').code).toContain('y = x != null;');
    expect(compile('x = 1\nif x?\n  f()\n').code).toContain('if (x != null) {');
    // Comparison and arrow continuations keep the existence reading.
    expect(compile('x = 1\nz = x? == true\n').code).toContain('z = (x != null) === true;');
    // A declaration-operator continuation mints the marker instead —
    // `empty? = 1` is the optional-marked plain assignment (
    // parity: the marker is metadata there too).
    expect(compile('empty? = 1').code).toContain('empty = 1;');
  });

  test('the optional marker rides every member operator: `? =`, `? ~=`, `? =!` lower as the unmarked forms , marker recorded', () => {
    expect(compile('C = component\n  @name? = 1\n  render\n    div "x"\n').code)
      .toContain('this.name = props.name ?? 1;');
    expect(compile('C = component\n  @name? =! 1\n  render\n    div "x"\n').code)
      .toContain('this.name = props.name ?? 1;');
    expect(compile('C = component\n  x := 1\n  @big? ~= x * 2\n  render\n    div "x"\n').code)
      .toContain('this.big = __computed(() => (this.x.value * 2));');
    // The marker's span records on each declaration node.
    const src = 'C = component\n  @name? =! 1\n  render\n    div "x"\n';
    const r = parser.parse(src);
    const out = emit(r, { source: src });
    const decl = r.sexpr[1][2][2][1];
    const role = out.stores.role(out.stores.idOf(decl), 'optionalMarker');
    expect(role).not.toBeNull();
    expect(src.slice(role.sourceStart, role.sourceEnd)).toBe('?');
  });

  test('the three-way combination `@name?: T <op> v` — marker + annotation + operator, every -legal cell, both spellings', () => {
    // The optional marker admits a TYPE annotation before the
    // operator; each cell lowers exactly like its untyped optional
    //.
    expect(compile('C = component\n  @name?: string := "anon"\n  render\n    div "x"\n').code)
      .toContain('this.name = __state(props.__bind_name__ ?? props.name ?? "anon");');
    // The spaced spelling is the same program.
    expect(compile('C = component\n  @name? : string := "anon"\n  render\n    div "x"\n').code)
      .toContain('this.name = __state(props.__bind_name__ ?? props.name ?? "anon");');
    expect(compile('C = component\n  @name?: string = "anon"\n  render\n    div "x"\n').code)
      .toContain('this.name = props.name ?? "anon";');
    expect(compile('C = component\n  x := 1\n  @big?: number ~= x * 2\n  render\n    div "x"\n').code)
      .toContain('this.big = __computed(() => (this.x.value * 2));');
    expect(compile('C = component\n  @max?: number =! 10\n  render\n    div "x"\n').code)
      .toContain('this.max = props.max ?? 10;');
    // Bodiless: an optional TYPED prop.
    expect(compile('C = component\n  @label?: string\n  render\n    div "x"\n').code)
      .toContain('this.label = __state(props.__bind_label__ ?? props.label);');
  });

  test('the three-way combination records BOTH side-band roles — optionalMarker and annotation (M12-E reads the pair)', () => {
    const src = 'C = component\n  @name?: string := "anon"\n  render\n    div "x"\n';
    const r = parser.parse(src);
    const out = emit(r, { source: src });
    const decl = r.sexpr[1][2][2][1];
    const id = out.stores.idOf(decl);
    const marker = out.stores.role(id, 'optionalMarker');
    expect(marker).not.toBeNull();
    expect(src.slice(marker.sourceStart, marker.sourceEnd)).toBe('?');
    const annotation = out.stores.role(id, 'annotation');
    expect(annotation).not.toBeNull();
    expect(src.slice(annotation.sourceStart, annotation.sourceEnd)).toBe(': string');
    // Sexpr stays the unmarked/untyped shape.
    expect(JSON.stringify(decl)).toBe('["state",[".","this","name"],"\\"anon\\""]');
  });

  test('the widened `?:` minting never disturbs existence-adjacent shapes', () => {
    // Postfix existence with a following comparison/ternary spelling.
    expect(compile('x = 1\ny = x?\n').code).toContain('y = x != null;');
    expect(compile('x = 1\nz = x? == true\n').code).toContain('z = (x != null) === true;');
    // A tight `?` before a colon in a VALUE position has no
    // declaration reading — loud either way (was loud before).
    parseFails('x = 1\ny = x? : 2');
    // Spaced ternaries are untouched.
    expect(compile('a = 1\nb = if a then 2 else 3\n').code).toContain('b = a ? 2 : 3;');
  });

  test('`@items: Array<number>` lowers as a required typed prop — generic type text is legal here', () => {
    expect(compile('C = component\n  @items: Array<number>\n  render\n    div "x"\n').code)
      .toContain('this.items = __state(props.__bind_items__ ?? props.items);');
  });
});

// ════════════════════════════════════════════════════════════════════
// The member model
// ════════════════════════════════════════════════════════════════════

describe('the member model: _init lowering and member unwrap', () => {
  const SRC = `Counter = component
  count := 0
  @label
  @opt?
  @step := 1
  limit =! 100
  note = "plain"
  total ~= count * 2
  onClick = (e) ->
    count += step
  beforeMount = ->
    console.log note
  ~> console.log count
  offer theme := "dark"
  accept locale
  render
    div "x"
`;

  test('the full seven-spelling lowering,  order, static __props', () => {
    const { code } = compile(SRC);
    expect(code).toContain("static __props = ['label', 'opt', 'step'];");
    const init = code.slice(code.indexOf('_init(props) {'), code.indexOf('onClick(e)'));
    const lines = init.split('\n').map((l) => l.trim()).filter((l) => l && l !== '}' && !l.startsWith('_init'));
    expect(lines).toEqual([
 'this.limit = 100;',
 'this.note = "plain";',
      "this.locale = getContext('locale');",
 'this.count = __state(0);',
 'this.label = __state(props.__bind_label__ ?? props.label);',
 'this.opt = __state(props.__bind_opt__ ?? props.opt);',
 'this.step = __state(props.__bind_step__ ?? props.step ?? 1);',
 'this.theme = __state("dark");',
 'this.total = __computed(() => (this.count.value * 2));',
      "setContext('theme', this.theme);",
 '__effect(() => { return console.log(this.count.value); });',
    ]);
  });

  test('member reads/writes rewrite: reactive → this.x.value, plain → this.x; methods emit as class methods', () => {
    const { code } = compile(SRC);
    expect(code).toContain('onClick(e) {\n    return (this.count.value += this.step.value);\n  }');
    expect(code).toContain('beforeMount() {\n    return console.log(this.note);\n  }');
  });

  test('this-member chains unwrap at the member link (`@user.name` → this.user.value.name)', () => {
    const { code } = compile('C = component\n  user := { name: "a" }\n  greet = ->\n    @user.name\n  render\n    div "x"');
    expect(code).toContain('return this.user.value.name;');
  });

  test('locals and params shadow members; members shadow module reactive names', () => {
    const { code } = compile(`mcount := 1
C = component
  count := 0
  probe = (count) ->
    count + 1
  local = ->
    x = count
    mcount = 4
    x
  render
    div "x"
`);
    // The param shadows the member.
    expect(code).toContain('probe(count) {\n    return (count + 1);\n  }');
    // A member read assigns into a fresh local; a module reactive name
    // writes its container's .value.
    expect(code).toContain('x = this.count.value;');
    expect(code).toContain('mcount.value = 4;');
  });

  test('object shorthand expands member reads ({count} → {count: this.count.value})', () => {
    const { code } = compile('C = component\n  count := 0\n  snap = ->\n    { count }\n  render\n    div "x"');
    expect(code).toContain('return {count: this.count.value};');
  });

  test('thin arrows force FAT inside component bodies (\'s rule — `this` stays the instance)', () => {
    const { code } = compile('C = component\n  count := 0\n  make = ->\n    -> count\n  render\n    div "x"');
    expect(code).toContain('return (() => this.count.value);');
    expect(code).not.toContain('function()');
  });

  test('a generator thin arrow inside a component rejects (no generator arrows in JS)', () => {
    emitFails('C = component\n  make = ->\n    g = ->\n      yield 1\n    g\n  render\n    div "x"',
      /generator arrow cannot sit inside a component body/);
  });

  test('a multi-statement computed block is its own scope (hoists, implicit return)', () => {
    const { code } = compile('C = component\n  a := 1\n  big ~=\n    b = a * 10\n    b + 1\n  render\n    div "x"');
    expect(code).toContain('this.big = __computed(() => {\n      let b = this.a.value * 10;\n      return (b + 1);\n    });');
  });

  test('colon-method groups categorize (`save: (e) ->` spelling), hooks included', () => {
    const { code } = compile('C = component\n  x := 1\n  double: (v) ->\n    v * 2\n  mounted: ->\n    console.log @double(x)\n  render\n    div "x"');
    expect(code).toContain('double(v)');
    expect(code).toContain('mounted()');
    expect(code).toContain('this.double(this.x.value)');
  });

  test('void methods (`save! = ->`, `fn!: ->`) suppress the implicit return', () => {
    const { code } = compile('C = component\n  count := 0\n  bump! = ->\n    count += 1\n  render\n    div "x"');
    expect(code).toContain('bump() {\n    this.count.value += 1;\n    return;\n  }');
  });

  test('async methods and awaiting effects carry async', () => {
    const { code } = compile('C = component\n  load = ->\n    await fetch("/x")\n  ~> await fetch("/y")\n  render\n    div "x"');
    expect(code).toContain('async load()');
    expect(code).toContain('__effect(async () => { return await fetch("/y"); });');
  });

  test('component-body effects RETURN their expression body (\'s component shape — the cleanup channel; module effects deliberately do not — , both pinned)', () => {
    const comp = compile('C = component\n  ~> setup()\n  render\n    div "x"').code;
    expect(comp).toContain('__effect(() => { return setup(); });');
    const mod = compile('~> setup()').code;
    expect(mod).toContain('__effect(() => { setup(); });');
  });

  test('a component with no render emits no _create/_setup; `render null` returns null', () => {
    const bare = compile('C = component\n  count := 0\n').code;
    expect(bare).not.toContain('_create');
    const nul = compile('C = component\n  render null\n').code;
    expect(nul).toContain('_create() {\n    return null;\n  }');
  });

  test('the declaration name threads into data-part through assignment and export', () => {
    expect(compile('Card = component\n  render\n    div "x"\n').code)
      .toContain("setAttribute('data-part', 'Card')");
    expect(compile('export Card = component\n  render\n    div "x"\n').code)
      .toContain("setAttribute('data-part', 'Card')");
  });

  test('a statement-position anonymous component groups (valid JS at statement start)', () => {
    const { code } = compile('component\n  count := 0\n');
    expect(code).toMatch(/^\(class extends __Component \{/);
    expect(() => new Function(code)).not.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════
// The parse-time defect layer — positioned negatives
// ════════════════════════════════════════════════════════════════════

describe('the defect layer: every silent  class rejects loudly, positioned', () => {
  test('#121: a body statement matching no category rejects ', () => {
    emitFails('C = component\n  console.log "probe"\n  render\n    div "x"', /matches no category/s);
    // PRIMITIVE body lines (no NodeStore row) position from their
    // neighbors' recorded spans — the caret lands on the offending
    // line, never the component head.
    const src = 'C = component\n  x := 1\n  "note"\n  render\n    div "x"';
    const err = emitFails(src, /matches no category/);
    expect(src.slice(err.start, err.end)).toBe('"note"');
    const err2 = emitFails('C = component\n  42\n  render\n    div "x"', /matches no category/);
    expect('C = component\n  42\n  render\n    div "x"'.slice(err2.start, err2.end)).toBe('42');
    emitFails('C = component\n  if true\n    console.log "x"\n  render\n    div "x"', /matches no category/);
    emitFails('C = component\n  import "./x.js"\n  render\n    div "x"', /matches no category/);
    // The reserved gate spelling parses as a comparison — a bare
    // expression line, loudly rejected .
    emitFails('C = component\n  user <~ @app.data.user\n  render\n    div "x"', /matches no category/);
    // Type declarations have no member reading either.
    emitFails('C = component\n  type T = number\n  render\n    div "x"', /matches no category/);
  });

  test('#122: a duplicate render block rejects, positioned at the second', () => {
    const err = emitFails('C = component\n  render\n    div "first"\n  render\n    span "second"',
      /duplicate render block/s);
    const src = 'C = component\n  render\n    div "first"\n  render\n    span "second"';
    expect(src.slice(err.start, err.end)).toContain('span "second"');
  });

  test('#123: duplicate member names reject across ALL kinds', () => {
    emitFails('C = component\n  count := 0\n  count ~= 5\n  render\n    div "x"', /duplicate component member 'count'/s);
    emitFails('C = component\n  save = -> 1\n  save := 0\n  render\n    div "x"', /duplicate component member 'save'/);
    emitFails('C = component\n  x := 0\n  accept x\n  render\n    div "x"', /duplicate component member 'x'/);
    emitFails('C = component\n  @flag\n  flag = 1\n  render\n    div "x"', /duplicate component member 'flag'/);
    emitFails('C = component\n  mounted = -> 1\n  mounted = -> 2\n  render\n    div "x"', /duplicate component member 'mounted'/);
  });

  test('the generated-lifecycle namespace: a member named _init/_create/_setup/create_block_N rejects', () => {
    // A same-named member would become a DUPLICATE class method — JS
    // keeps the last, silently replacing the generated machinery.
    emitFails('C = component\n  _init = -> 1\n  render\n    div "x"', /member '_init' collides with the generated lifecycle machinery/);
    emitFails('C = component\n  _create = -> 1\n  render\n    div "x"', /member '_create' collides/);
    emitFails('C = component\n  _setup := 0\n  render\n    div "x"', /member '_setup' collides/);
    emitFails('C = component\n  create_block_0 = -> 1\n  render\n    div "x"', /member 'create_block_0' collides/);
  });

  test("the runtime API namespace: a member named mount/unmount/emit rejects in BOTH modes (the GPT addendum, F2)", () => {
    // Such a member silently shadowed the prototype API in JS mode
    // (the machinery calls mount/unmount/emit on every instance —
    // the unmount cascade would invoke the user's member), and the
    // typed artifacts declared the name twice (TS2300/TS2416 over
    // the whole component). The runtime already rejected declared
    // PROPS of these names at construction; the compile rejection
    // closes the private-member half of the same hazard.
    for (const name of ['mount', 'unmount', 'emit']) {
      emitFails(`C = component\n  ${name} := 1\n  render\n    div "x"`, /collides with the component runtime API/);
      emitFails(`C = component\n  ${name} = (x) -> x\n  render\n    div "x"`, /collides with the component runtime API/);
      // The face path rejects identically (JS mode is emitFails above).
      expect(() => compile(`C = component\n  ${name} := 1\n  render\n    div "x"`, { runtimeDelivery: 'none', face: 'ts' }))
        .toThrow(/collides with the component runtime API/);
    }
  });

  test('a component name bound TWICE at module scope rejects)', () => {
    // Main compiled the rebinding silently (the second class wins;
    // instances of the first keep the old identity) and the typed
    // artifacts would merge two same-named companion interfaces —
    // loud beats both, in BOTH modes.
    const src = 'X = component\n  n := 1\nX = component\n  m := 2\nconsole.log X';
    emitFails(src, /component 'X' is bound more than once at module scope/);
    expect(() => compile(src, { runtimeDelivery: 'none', face: 'ts' })).toThrow(/bound more than once at module scope/);
    // Distinct FUNCTION scopes never collide — their bindings never
    // reach the module surface.
    expect(() => compile('f = ->\n  C = component\n    n := 1\n  C\ng = ->\n  C = component\n    m := 2\n  C\nconsole.log f, g', { runtimeDelivery: 'none' })).not.toThrow();
    // Export + plain rebinding collides too.
    emitFails('export X = component\n  n := 1\nX = component\n  m := 2', /bound more than once at module scope/);
  });

  test("a user-SPELLED __bind_ key rejects — the compiler's two-way channel has ONE spelling (`<=>`)", () => {
    emitFails('C = component\n  sel := ""\n  render\n    input type: "text", __bind_value__: sel',
      /'__bind_…__:' is the compiler's two-way-binding channel/);
    emitFails('Chip = component\n  @size := 1\n  render\n    span "s"\nC = component\n  n := 2\n  render\n    div\n      Chip __bind_size__: n',
      /'__bind_…__:' is the compiler's two-way-binding channel/);
    // The `<=>` spelling itself still compiles — the MINTED key's
    // recorded span spells the user's own word (`size`), so the
    // span discrimination never catches the rewrite: the child bind
    // emits the `__bind_size__:` ctor key, the element bind its
    // listener pair.
    expect(compile('Chip = component\n  @size := 1\n  render\n    span "s"\nC = component\n  n := 2\n  render\n    div\n      Chip size <=> n', { runtimeDelivery: 'none' }).code)
      .toContain('__bind_size__: this.n');
    expect(compile('C = component\n  sel := ""\n  render\n    input type: "text", value <=> sel', { runtimeDelivery: 'none' }).code)
      .toContain("addEventListener('input'");
  });

  test('#127: offer of a non-declaration rejects ', () => {
    emitFails('C = component\n  offer console.log("hi")\n  render\n    div "x"', /offer takes a member DECLARATION/s);
    emitFails('C = component\n  offer 42\n  render\n    div "x"', /offer takes a member DECLARATION/);
  });

  test('#140: a bound effect in a component body rejects ', () => {
    emitFails('C = component\n  h ~> console.log 1\n  render\n    div "x"', /bound effect.*no component-body reading/s);
  });

  test('a lifecycle hook with a non-function value rejects ', () => {
    emitFails('C = component\n  mounted = 5\n  render\n    div "x"', /lifecycle hook 'mounted' takes a function value/);
  });

  test('member declarations with pattern targets reject', () => {
    emitFails('C = component\n  [a, b] := pair()\n  render\n    div "x"', /takes a plain name or '@name'/);
    emitFails('C = component\n  [c, d] = pair()\n  render\n    div "x"', /matches no category/);
  });

  test('a state initializer cannot await (construction is synchronous)', () => {
    emitFails('C = component\n  data := await load()\n  render\n    div "x"', /state initializer cannot await/);
  });

  test('`component extends` takes an HTML tag — a component parent rejects ', () => {
    emitFails('Base = component\n  render\n    div "b"\nSub = component extends Base\n  render\n    div "s"\n',
      /extends.*takes an HTML tag/s);
  });

  test('`component extends <tag>` whose render never creates the tag at CLASS SCOPE rejects — rest props would land nowhere ()', () => {
    emitFails('C = component extends button\n  render\n    div "x"', /never creates a '<button>' element at class scope/);
    // ... including through factories only (the old runtime binds class scope only).
    emitFails('C = component extends button\n  vis := true\n  render\n    div\n      if vis\n        button "x"',
      /never creates a '<button>' element at class scope/);
    // A NESTED class-scope element binds (the rule — first match at
    // any depth, not just the render root).
    const { code } = compile('C = component extends button\n  render\n    div\n      p\n        button "deep"\n');
    expect(code).toContain('this._inheritedEl = this._el2;');
  });

  test('an extends component cannot declare a member named `rest` — the rest view owns the name', () => {
    emitFails('C = component extends button\n  rest := 1\n  render\n    button "x"', /cannot declare a member named 'rest'/);
  });

  test('render/offer/accept outside a component body reject with \'s rule', () => {
    emitFails('render\n  div.card\n    "x"', /render blocks can only be used inside a component/);
    emitFails('x = render div "hi"', /render blocks can only be used inside a component/);
  });
});

// ════════════════════════════════════════════════════════════════════
// The static render DSL
// ════════════════════════════════════════════════════════════════════

describe('the static render DSL: emission pins', () => {
  test('elements, ids, classes, attributes, data sigils, hyphenated keys, text', () => {
    const { code } = compile(`P = component
  active := true
  render
    .card
      div#main "id kid"
      p class: "static"
      section $open: true, $my-thing: "x"
      article data-lucide: "search"
      div style: "color: red", innerHTML: "<b>x</b>"
      = active
      "literal"
`);
    expect(code).toContain("document.createElement('div')");
    expect(code).toContain("this._el1.id = 'main';");
    expect(code).toContain('this._el2.className = "static";');
    expect(code).toContain(`this._el3.setAttribute('data-open', true);`);
    expect(code).toContain(`this._el3.setAttribute('data-my-thing', "x");`);
    expect(code).toContain(`this._el4.setAttribute('data-lucide', "search");`);
    expect(code).toContain(`this._el5.setAttribute('style', "color: red");`);
    expect(code).toContain('this._el5.innerHTML = "<b>x</b>";');
    expect(code).toContain('__effect(() => { this._t1.data = String(this.active.value); });');
    expect(code).toContain('createTextNode("literal")');
    expect(code).toContain("this._el0.className = 'card';");
  });

  test('the __clsx dynamic-class surface: line-start, tag-tail, class: values, selector merges', () => {
    const { code } = compile(`P = component
  active := true
  render
    .('grid', active && 'on')
    div.('x')
    div.base.('extra')
    p class: active && "cls"
`);
    expect(code).toContain(`__effect(() => { this._el1.className = __clsx("grid", (this.active.value && "on")); });`);
    expect(code).toContain(`__effect(() => { this._el2.className = __clsx("x"); });`);
    expect(code).toContain(`__effect(() => { this._el3.className = __clsx('base', "extra"); });`);
    expect(code).toContain(`__effect(() => { this._el4.className = __clsx((this.active.value && "cls")); });`);
  });

  test('boolean attributes fork: reactive → toggleAttribute effect; static → guarded setAttribute', () => {
    const { code } = compile('P = component\n  busy := false\n  render\n    button disabled: busy\n    input readonly: true, type: "text"\n');
    expect(code).toContain("__effect(() => { this._el1.toggleAttribute('disabled', !!this.busy.value); });");
    expect(code).toContain("if (true) this._el2.setAttribute('readonly', '');");
    expect(code).toContain(`this._el2.setAttribute('type', "text");`);
  });

  test('value/checked with reactive deps push as properties (one-way)', () => {
    const { code } = compile('P = component\n  name := ""\n  render\n    input type: "text", value: name\n');
    expect(code).toContain('__effect(() => { this._el0.value = this.name.value; });');
  });

  test('bare-identifier boolean shorthand validates against the vocabulary (#125 fork)', () => {
    // Legal idioms stay legal.
    expect(compile('P = component\n  render\n    form noValidate\n').code)
      .toContain(`setAttribute('noValidate', true)`);
    expect(compile('P = component\n  render\n    div hidden\n').code)
      .toContain(`setAttribute('hidden', true)`);
    expect(compile('P = component\n  render\n    input required\n').code)
      .toContain(`setAttribute('required', true)`);
    // The misspelling space rejects, positioned (the old runtime ships markup).
    emitFails('P = component\n  count := 0\n  render\n    span countt\n', /'countt' is not a known attribute of <span>/s);
    emitFails('P = component\n  render\n    div claas\n', /not a known attribute of <div>/);
  });

  test('bare `@click` validates: DOM event + method existence (#124 middle); explicit bindings stay unvalidated', () => {
    // Bare: unknown event.
    emitFails('P = component\n  render\n    button @clack\n', /`@clack` is not a DOM event/);
    // Bare: missing method.
    emitFails('P = component\n  render\n    button @click\n', /requires a component method `onClick`/);
    // Bare: the onError ambiguity.
    emitFails('P = component\n  onError = -> 1\n  render\n    img @error\n', /ambiguous with the onError lifecycle hook/);
    // Bare with the method present: batched member dispatch.
    expect(compile('P = component\n  onClick = -> 1\n  render\n    button @click\n').code)
      .toContain("this._el0.addEventListener('click', (e) => __batch(() => (this.onClick)(e)));");
    // Explicit custom event names are LEGAL DOM — compile parity (a
    // typo'd name is a dead listener; editor intelligence is ).
    expect(compile('P = component\n  save = -> 1\n  render\n    button @clik: @save\n').code)
      .toContain("this._el0.addEventListener('clik', (e) => __batch(() => (this.save)(e)));");
    // A bare member identifier as the handler dispatches directly.
    expect(compile('P = component\n  save = -> 1\n  render\n    button @click: save\n').code)
      .toContain("this._el0.addEventListener('click', (e) => __batch(() => this.save(e)));");
  });

  test('a bare directive with INLINE text means handler + text child', () => {
    const bytes = (src) => compile(src, { runtimeDelivery: 'none' }).code.match(/_create\(\) \{[\s\S]*?\n  \}/)[0];
    const inline = bytes('C = component\n  onClick = -> 1\n  render\n    button @click "go"\n');
    expect(inline).toContain("addEventListener('click', (e) => __batch(() => (this.onClick)(e)))");
    expect(inline).toContain('createTextNode("go")');
    // ≡ the comma-list spelling, byte-for-byte.
    expect(inline).toBe(bytes('C = component\n  onClick = -> 1\n  render\n    button @click, "go"\n'));
    // Two directives + inline text; a directive followed by an
    // attribute pair on the same line.
    const two = bytes('C = component\n  onClick = -> 1\n  onFocus = -> 2\n  render\n    button @click @focus "go"\n');
    expect(two).toContain("addEventListener('focus'");
    expect(two).toContain('createTextNode("go")');
    const attr = compile('C = component\n  onClick = -> 1\n  count := 0\n  render\n    button @click disabled: count > 5\n', { runtimeDelivery: 'none' }).code;
    expect(attr).toContain("addEventListener('click'");
    expect(attr).toContain("toggleAttribute('disabled'");
  });

  test('a `=` directly after a bare event directive rejects positioned — never an assignment-invoked listener', () => {
    // The one-line tag-head spelling, positioned ON the `=`.
    const head = 'C = component\n  count := 0\n  onClick = -> count += 1\n  render\n    button @click = count\n';
    const err = lexFails(head, /a `=` cannot follow a bare event directive/s);
    expect(head[err.start]).toBe('=');
    // The element-body continuation line takes the same rejection.
    lexFails('C = component\n  count := 0\n  onClick = -> count += 1\n  render\n    button\n      @click = count\n',
      /a `=` cannot follow a bare event directive/);
  });

  test('the bare-event neighbors hold around the rejection: indented child, comma list, inline text, explicit binding, undirected `= expr` text', () => {
    const handler = "addEventListener('click', (e) => __batch(() => (this.onClick)(e)))";
    // Bare directive + indented child.
    const child = compile('C = component\n  onClick = -> 1\n  render\n    button @click\n      "go"\n', { runtimeDelivery: 'none' }).code;
    expect(child).toContain(handler);
    expect(child).toContain('createTextNode("go")');
    // The comma-list and inline-text spellings.
    expect(compile('C = component\n  onClick = -> 1\n  render\n    button @click, "go"\n', { runtimeDelivery: 'none' }).code).toContain(handler);
    expect(compile('C = component\n  onClick = -> 1\n  render\n    button @click "go"\n', { runtimeDelivery: 'none' }).code).toContain(handler);
    // The explicit binding — a user-written `=` there stays compile
    // parity (the fork: explicit bindings are never validated).
    expect(compile('C = component\n  count := 0\n  onClick = -> 1\n  render\n    button @click: @onClick = count\n', { runtimeDelivery: 'none' }).code)
      .toContain("addEventListener('click', (e) => __batch(() => (this.onClick = this.count.value)(e)))");
    // A `= expr` text line NOT preceded by a directive is untouched.
    const text = compile('C = component\n  count := 0\n  onClick = -> 1\n  render\n    button @click\n      = count\n', { runtimeDelivery: 'none' }).code;
    expect(text).toContain(handler);
    expect(text).toContain('__effect(() => { this._t0.data = String(this.count.value); });');
  });

  test('bare `@prop` in a directive slot takes the DOM-event rejection; a child slot takes the `= @prop` guidance (both \'s rules)', () => {
    emitFails('P = component\n  msg := "x"\n  render\n    div\n      @msg\n', /`@msg` is not a DOM event.*use `= @msg`/s);
    emitFails('P = component\n  msg := "x"\n  render\n    @msg\n', /bare `@msg` is not rendered as text/);
  });

  test('text children: reactive members bind live; plain members stringify once; an own-line module binding is a TAG , an arg-position one renders text', () => {
    const { code } = compile('lbl = "static"\nP = component\n  count := 0\n  note = "n"\n  render\n    div\n      count\n      note\n      lbl\n');
    expect(code).toContain('__effect(() => { this._t0.data = this.count.value; });');
    expect(code).toContain('this._t1 = document.createTextNode(String(this.note));');
    expect(code).toContain("this._el1 = document.createElement('lbl');");
    const arg = compile('lbl = "static"\nP = component\n  render\n    em lbl\n').code;
    expect(arg).toContain('this._t0 = document.createTextNode(lbl);');
  });

  test('`= expr` with an indented continuation rejects — never a silent discard', () => {
    const src = 'T = component\n  items := [1, 2]\n  render\n    div\n      = @items\n        .map (v) -> v * 2\n';
    emitFails(src, /the `= expr` text form takes ONE expression/s);
  });

  test('a member chain in an attribute value keeps the subtraction reading — never a rewritten property name', () => {
    const { code } = compile('T = component\n  box := { w: 10 }\n  render\n    div width: @box.w-pad\n');
    expect(code).toContain("setAttribute('width', (this.box.value.w - pad))");
    // Class-SELECTOR chains keep the hyphen consumption: tag-rooted
    // and bare line-start dots.
    const cls = compile('T = component\n  render\n    .counter-display "a"\n    span.badge.big-x "c"\n').code;
    expect(cls).toContain("className = 'counter-display'");
    expect(cls).toContain("className = 'badge big-x'");
    // Capitalized roots are value chains too: `Math.max-1` subtracts.
    expect(compile('T = component\n  render\n    div width: Math.max-1\n').code)
      .toContain("setAttribute('width', (Math.max - 1))");
  });

  test('a parameterized chain continuation under an element rejects — never minted nonsense DOM', () => {
    emitFails('C = component\n  items := [1]\n  render\n    div items\n      .map (v) -> v\n',
      /parameterized function is not a render child/s);
  });

  test('a nested component declaration is a plain field whose data-part takes the MEMBER name', () => {
    const { code } = compile('A = component\n  B = component\n    y := 1\n    render\n      span "inner"\n  render\n    div "outer"\n');
    expect(code).toContain('this.B = class extends __Component {');
    // The inner render's data-part prints the MEMBER's name —
    // threads names through plain assignment only and prints the
    // ENCLOSING component's (the quirk, graduated at ).
    const inner = code.slice(code.indexOf('this.B ='), code.indexOf('div'));
    expect(inner).toContain("setAttribute('data-part', 'B')");
    expect(inner).not.toContain("setAttribute('data-part', 'A')");
  });

  test('a tight `#word` line meant as a comment becomes an id element — cataloged; the comment spelling is spaced `# word`', () => {
    // Both compilers ship the same absurd-but-legal call chain; the
    // catalog carries the class, the spaced spelling stays a comment.
    const { code } = compile('T = component\n  render\n    div\n      #note this was a comment\n');
    expect(code).toContain("this._el1.id = 'note';");
    expect(code).toContain('document.createTextNode(String(this(was(a(comment)))))');
  });

  test('module-level reactive names bind LIVE in render ', () => {
    const { code } = compile('mcount := 5\nP = component\n  render\n    div\n      = mcount + 1\n');
    expect(code).toContain('__effect(() => { this._t0.data = String((mcount.value + 1)); });');
  });

  test('multi-root renders capture their top-level nodes for unmount', () => {
    const { code } = compile('P = component\n  render\n    div "a"\n    span "b"\n');
    expect(code).toContain('this._nodes = [...this._frag0.childNodes];');
  });

  test('SVG elements create through the namespace and set class via setAttribute', () => {
    const { code } = compile('P = component\n  render\n    svg viewBox: "0 0 10 10"\n      circle cx: "5"\n');
    expect(code).toContain("document.createElementNS('http://www.w3.org/2000/svg', 'svg')");
    expect(code).toContain("document.createElementNS('http://www.w3.org/2000/svg', 'circle')");
  });

  test('presence values keep their guarded attribute forms', () => {
    const { code } = compile('P = component\n  vis := true\n  render\n    div title: vis?!\n    div lang: "x"?!\n');
    expect(code).toContain("__effect(() => { { const __v = (this.vis.value ? true : undefined); __v == null ? this._el1.removeAttribute('title') : this._el1.setAttribute('title', __v); } });");
    expect(code).toContain(`{ const __v = ("x" ? true : undefined); if (__v != null) this._el2.setAttribute('lang', __v); }`);
  });

  test('unknown lowercase words: a BARE line is a custom element; with args it is a CALL rendered as text (\'s rules, both)', () => {
    expect(compile('P = component\n  render\n    widget\n').code)
      .toContain("document.createElement('widget')");
    expect(compile('P = component\n  render\n    widget "x"\n').code)
      .toContain('document.createTextNode(String(widget("x")))');
  });
});

describe('the reserved-name mechanism: minted scaffold names never capture user variables', () => {
  const LOOP = (v) => `L = component
  items := [1, 2]
  hits = []
  render
    ul
      for ${v} in items
        li @click: ((x) => @hits.push(${v}))
          if ${v} > 1
            b
              = ${v}
          else
            em
              = ${v}
`;
  test('the scaffold-name sweep: every minted name as a loop variable compiles and Function-validates', () => {
    for (const v of ['ctx', 'o', 'fr', 'anchor', 'currentBlock', 'showing', 'show', 'want', 'leaving', 'e', 'target', 'detaching', 's', 'b_']) {
      const { code } = compile(LOOP(v), { runtimeDelivery: 'none' });
      expect(() => new Function(code)).not.toThrow();
    }
  });

  test('the F1 cells: `o`/`fr`/`ctx` loop variables — the factory scaffold renames itself, the user names keep their rows', () => {
    // The p() re-bind params mint AROUND the scaffold: `o`'s re-bind
    // dodges the owner token, `fr`'s dodges the patch frame.
    const o = compile(LOOP('o'), { runtimeDelivery: 'none' }).code;
    expect(o).toContain('p(ctx, __o_, __i)');
    expect(o).toContain('o = __o_;');
    expect(o).toMatch(/const __o = __pushOwner/);
    const fr = compile(LOOP('fr'), { runtimeDelivery: 'none' }).code;
    expect(fr).toContain('p(ctx, __fr_, __i)');
    expect(fr).toContain('fr = __fr_;');
    expect(fr).toMatch(/let __fr;\n/);
    const ctx = compile(LOOP('ctx'), { runtimeDelivery: 'none' }).code;
    expect(ctx).toContain('create_block_0(ctx_, ctx, i)');
    expect(ctx).toContain('ctx_.hits.push(ctx)');
  });

  test('the swap scaffold dodges loop variables its condition reads (`anchor`/`show`/`want` — a collision would render the wrong branch or throw TDZ)', () => {
    const a = compile(LOOP('anchor'), { runtimeDelivery: 'none' }).code;
    expect(a).toMatch(/const anchor_ = _anchor\d+;/);
    expect(a).toContain('const show = !!((anchor > 1));');
    const s = compile(LOOP('show'), { runtimeDelivery: 'none' }).code;
    expect(s).toContain('const show_ = !!((show > 1));');
  });

  test('the minted listener param dodges a handler-read `e` ', () => {
    const { code } = compile('L = component\n  items := [1]\n  hits = []\n  render\n    ul\n      for e in items\n        li @click: ((x) => @hits.push(e))\n          = e\n', { runtimeDelivery: 'none' });
    expect(code).toContain("addEventListener('click', (e_) => __batch(() => (x => ctx.hits.push(e))(e_)))");
  });

  test('double-underscore names are the compiler/runtime namespace inside render: loop vars and locals reject positioned', () => {
    emitFails('L = component\n  items := [1]\n  render\n    for __x in items\n      li\n        = __x\n',
      /render loop variable '__x'/s);
    emitFails('T = component\n  render\n    __y = 1\n    div\n      = __y\n',
      /render local '__y'/s);
  });
});

describe('cross-scope local reads reject in EVERY attribute position', () => {
  const wrap = (line) => `T = component
  vis := true
  render
    total = 1
    div
      = total
      if vis
        ${line}
`;
  test.each([
    ['static attribute', 'span title: total, "x"'],
    ['reactive-shaped attribute', 'span title: total + vis, "x"'],
    ['boolean attribute', 'button disabled: total'],
    ['class: value', 'span class: total, "x"'],
    ['dynamic-class expression', 'span.("on", total)'],
    ['event handler body', 'button @click: ((x) => f(total))'],
    ['bind chain', 'input value <=> box[total].x'],
    ['presence value', 'span lang: total?!'],
  ])('%s', (_name, line) => {
    emitFails(wrap(line), /render local.*ENCLOSING render scope|render local 'total' is not visible here/);
  });
});

// The  boundary graduated: child components, slot, extends, and
// the composition surface land below (the composition suites). No
// language surface stays parked for  — it owns the face/.d.ts/
// editor story only, so this file carries no -named rejections.

// ════════════════════════════════════════════════════════════════════
// The dynamic render layer
// ════════════════════════════════════════════════════════════════════

describe('conditionals: anchor + branch factories + one swap effect', () => {
  test('if/else compiles to factory methods, an anchor comment, and the swap block', () => {
    const { code } = compile('T = component\n  vis := true\n  render\n    div\n      if vis\n        span "yes"\n      else\n        b "no"\n');
    expect(code).toContain("this._anchor1 = document.createComment('if');");
    expect(code).toContain('const show = !!(this.vis.value);');
    expect(code).toContain("const want = show ? 'then' : 'else';");
    expect(code).toContain('if (want === showing) return;');
    expect(code).toContain("__transition(leaving._first, leaving._t, 'leave', () => leaving.d(true));");
    expect(code).toContain('currentBlock = this.create_block_0(this);');
    expect(code).toContain('currentBlock = this.create_block_1(this);');
    expect(code).toContain('if (anchor.parentNode) currentBlock.m(anchor.parentNode, anchor.nextSibling);');
    expect(code).toContain('__ownerFrame().add(() => { if (currentBlock) { currentBlock.d(true); currentBlock = null; } });');
    // The branch factories are class methods returning the handle.
    expect(code).toContain('create_block_0(ctx) {');
    expect(code).toContain('this._first = _el2;');
    expect(code).toContain('if (detaching) __detach(_el2);');
    // No else → want falls to null.
    expect(compile('T = component\n  vis := true\n  render\n    div\n      if vis\n        span "y"\n').code)
      .toContain("const want = show ? 'then' : null;");
    expect(() => new Function(code)).not.toThrow();
  });

  test('else-if chains recurse: the else branch factory holds the nested conditional', () => {
    const { code } = compile('T = component\n  n := 1\n  render\n    div\n      if n == 1\n        span "one"\n      else if n == 2\n        span "two"\n      else\n        span "many"\n');
    // Four factories: then, else (chain), inner then, inner else.
    expect(code.match(/create_block_\d+\(ctx\) \{/g).length).toBe(4);
    expect(code).toContain('const show = !!((ctx.n.value === 2));');
    // The nested swap runs inside the chain factory's p() under its frame.
    expect(code).toContain('const __o = __pushOwner(__fr = __ownerFrame());');
    expect(() => new Function(code)).not.toThrow();
  });

  test('unless, inline-then, and postfix conditionals all take the factory path ', () => {
    expect(compile('T = component\n  vis := true\n  render\n    div\n      unless vis\n        span "no"\n').code)
      .toContain('const show = !!(!this.vis.value);');
    expect(compile('T = component\n  vis := true\n  render\n    div\n      if vis then span "y" else b "n"\n').code)
      .toContain("document.createElement('span')");
    const postfix = compile('T = component\n  vis := true\n  render\n    div\n      span "a" if vis\n').code;
    expect(postfix).toContain("document.createElement('span')");
    expect(postfix).toContain("document.createComment('if')");
  });

  test('switch folds to the if-chain (\'s transformation): === tests, OR-joined lists, else → the final branch', () => {
    const { code } = compile('T = component\n  n := 1\n  render\n    div\n      switch n\n        when 1\n          span "one"\n        when 2, 3\n          span "few"\n        else\n          span "many"\n');
    expect(code).toContain('const show = !!((this.n.value === 1));');
    expect(code).toContain('const show = !!(((ctx.n.value === 2) || (ctx.n.value === 3)));');
    expect(code.match(/create_block_\d+\(ctx\) \{/g).length).toBe(4);
    expect(() => new Function(code)).not.toThrow();
  });

  test('`= expr` with an expression-if stays TEXT (never a block factory)', () => {
    const { code } = compile('T = component\n  vis := true\n  render\n    div\n      = if vis then "y" else "n"\n');
    expect(code).toContain(`__effect(() => { this._t0.data = String((this.vis.value ? "y" : "n")); });`);
    expect(code).not.toContain('create_block');
  });

  test('a class-scope condition reading a render local rejects (locals live in _create;  ships a mount ReferenceError)', () => {
    emitFails('T = component\n  vis := true\n  render\n    flag = 1\n    div\n      = flag\n      if flag > 0\n        span "x"\n',
      /render local cannot appear in a LIVE binding or a dynamic block head/);
  });
});

describe('loops: __reconcile with WORKING keys (#126 compile half)', () => {
  test('a keyed loop extracts the key into a keyFn and NEVER emits it as an attribute', () => {
    const { code } = compile('L = component\n  items := [{id: 1, name: "a"}]\n  render\n    ul\n      for item in items\n        li key: item.id\n          = item.name\n');
    expect(code).toContain('__reconcile(this._anchor1, __s, this.items.value, this, this.create_block_0, (item, i) => item.id);');
    expect(code).not.toContain("setAttribute('key'");
    expect(code).toContain('create_block_0(ctx, item, i) {');
    expect(code).toContain('__effect(() => { _t0.data = String(item.name); });');
    expect(code).toContain('__ownerFrame().add(() => { for (const __b of __s.blocks) { try { __b.d(true); } catch {} } __s.blocks = []; __s.keys = []; __s.items = []; });');
    expect(() => new Function(code)).not.toThrow();
  });

  test('the indented-attribute `key:` spelling extracts too ', () => {
    const { code } = compile('L = component\n  items := [{id: 1}]\n  render\n    ul\n      for item in items\n        li\n          key: item.id\n          = item.id\n');
    expect(code).toContain('(item, i) => item.id');
    expect(code).not.toContain("setAttribute('key'");
  });

  test('an unkeyed loop passes null (identity keying — the M12-A runtime default)', () => {
    const { code } = compile('L = component\n  items := ["a"]\n  render\n    ul\n      for item in items\n        li\n          = item\n');
    expect(code).toContain('this.create_block_0, null);');
  });

  test('p() re-binds the factory params so create-phase listeners track the CURRENT row ', () => {
    const { code } = compile('L = component\n  items := [{id: 1}]\n  hits = []\n  render\n    ul\n      for item in items\n        li key: item.id, @click: ((e) => @hits.push(item.id))\n          = item.id\n');
    expect(code).toContain('p(ctx, __item, __i) {');
    expect(code).toContain('item = __item; i = __i;');
    // The minted listener param dodges the handler's own `e` (the
    // #161 mechanism — the user arrow keeps its name).
    expect(code).toContain("addEventListener('click', (e_) => __batch(() => (e => ctx.hits.push(item.id))(e_)))");
  });

  test('a static row block carries _s and an empty p() (the reconciler skips patching it)', () => {
    const { code } = compile('L = component\n  render\n    ul\n      for item in [1, 2]\n        li "static"\n');
    expect(code).toContain('_s: true,');
    expect(code).toMatch(/p\(ctx, item, i\) \{\n\s*\},/);
  });

  test('item AND index reads are live over a reactive collection ; loop vars shadow members', () => {
    const { code } = compile('L = component\n  items := ["a"]\n  render\n    ul\n      for item, idx in items\n        li\n          = idx\n          span item\n');
    expect(code).toContain('__effect(() => { _t0.data = String(idx); });');
    expect(code).toContain('__effect(() => { _t1.data = item; });');
  });

  test('the auto-picked index dodges every name the body spells — an `<i>` element line survives (\'s auto `i` swallows it)', () => {
    const { code } = compile('L = component\n  items := [1]\n  render\n    ul\n      for item in items\n        li\n          i "italic"\n');
    expect(code).toContain('create_block_0(ctx, item, j) {');
    expect(code).toContain("document.createElement('i')");
  });

  test('nested loops bind OWN vars first, then the threaded outer names — the runtime ABI (`factory(ctx, item, i, ...outer)`, \'s order)', () => {
    const { code } = compile('T = component\n  rows := [[1]]\n  render\n    div\n      for row in rows\n        for cell in row\n          span\n            = cell\n');
    // The GPT round's blocker: outer-first parameters bound nested
    // rows CROSSWISE (the inner item arrived in the outer-row slot).
    expect(code).toContain('create_block_1(ctx, cell, j, row, i) {');
    expect(code).toContain('p(ctx, __cell, __j, __row, __i) {');
    expect(code).toContain('cell = __cell; j = __j; row = __row; i = __i;');
    expect(code).toContain('__reconcile(_anchor2, __s, row, ctx, ctx.create_block_1, null, row, i);');
    expect(() => new Function(code)).not.toThrow();
  });

  test('ranges drive loops through the standard range lowering', () => {
    const { code } = compile('T = component\n  n := 3\n  render\n    ul\n      for v in [1..n]\n        li\n          = v\n');
    expect(code).toContain('__reconcile(this._anchor1, __s, ');
    expect(() => new Function(code)).not.toThrow();
  });

  test('positioned rejections: guards, steps, for-of, async loops, while/comprehension, destructuring vars', () => {
    emitFails('T = component\n  items := [1, 2]\n  render\n    ul\n      for item in items when item > 1\n        li\n          = item\n',
      /`when` guard has no render reading/s);
    emitFails('T = component\n  items := [1, 2]\n  render\n    ul\n      for item in items by 2\n        li\n          = item\n',
      /`by` step has no render reading/s);
    emitFails('T = component\n  obj := {a: 1}\n  render\n    ul\n      for k, v of obj\n        li\n          = k\n',
      /`for … of` \(object iteration\) has no reconcile reading/s);
    emitFails('T = component\n  n := 3\n  render\n    div\n      while n > 0\n        span "x"\n',
      /only `for … in` drives list rendering/s);
    emitFails('T = component\n  items := [1]\n  render\n    div\n      (x * 2 for x in items)\n',
      /only `for … in` drives list rendering/);
    emitFails('T = component\n  pairs := [[1, 2]]\n  render\n    ul\n      for [a, b] in pairs\n        li\n          = a\n',
      /destructuring loop variables have no factory-parameter reading/);
  });

  test('a `key:` reading a BODY render local rejects — the keyFn lives in loop-header scope ', () => {
    emitFails('L = component\n  items := [{id: 1}]\n  render\n    ul\n      for item in items\n        k = item.id\n        li key: k\n          = item.id\n',
      /`key:` expression must be evaluable in the loop HEADER scope/);
  });

  test('a `key:` that never reads the row rejects — row-independent keys cannot identify rows (`key: missing.id`, constant keys)', () => {
    emitFails('L = component\n  items := [{id: 1}]\n  render\n    ul\n      for item in items\n        li key: missing.id\n          = item.id\n',
      /loop key must derive from the row/s);
    emitFails('L = component\n  items := [1, 1]\n  render\n    ul\n      for item in items\n        li key: "same"\n          = item\n',
      /loop key must derive from the row/);
    // Row-derived keys stay legal in every spelling — item chains,
    // index reads, calls over the item.
    expect(() => compile('L = component\n  items := [{id: 1}]\n  render\n    ul\n      for item, idx in items\n        li key: idx\n          = item.id\n')).not.toThrow();
    expect(() => compile('L = component\n  items := [{id: 1}]\n  render\n    ul\n      for item in items\n        li key: String(item.id)\n          = item.id\n')).not.toThrow();
  });

  test('the dead-local counter never counts attribute KEYS or property names as reads (the GPT round\'s F4)', () => {
    // `div x: "attr"` spells `x` only as a pair KEY — the local is
    // still dead and rejects.
    emitFails('T = component\n  render\n    x = 1\n    div x: "attr"\n', /render local 'x' is never read/);
    emitFails('T = component\n  obj = {}\n  render\n    y = 1\n    div\n      = @thing.y\n', /render local 'y' is never read|matches no category/);
    // A real VALUE read still counts.
    expect(() => compile('T = component\n  render\n    x = 1\n    div title: x, "t"\n')).not.toThrow();
  });

  test('`key:` anywhere except the loop-body root element rejects, positioned ', () => {
    emitFails('P = component\n  render\n    div key: 1\n', /`key:` identifies loop rows/s);
    emitFails('P = component\n  items := [1]\n  render\n    for item in items\n      li\n        span key: item\n          = item\n',
      /`key:` identifies loop rows/);
  });
});

describe('render locals: \'s scope rules plus the structural loudness edges', () => {
  test('locals declare with `=`, mutate with compound forms, read as text, and shadow tags', () => {
    const { code } = compile('T = component\n  items := [1, 2]\n  render\n    total = items.length\n    total += 1\n    div\n      = total\n');
    expect(code).toContain('let total;');
    expect(code).toContain('total = this.items.value.length;');
    expect(code).toContain('total += 1;');
    expect(code).toContain('createTextNode(String(total))');
    // A local shadowing a tag name: reads are values, never elements —
    // own-line reads take the String() wrap (the emitNode shape), the
    // same-line arg position stays raw (the appendChildren shape).
    const shadow = compile('T = component\n  render\n    code = 42\n    span\n      code\n').code;
    expect(shadow).toContain('code = 42;');
    expect(shadow).toContain('createTextNode(String(code))');
    expect(shadow).not.toContain("createElement('code')");
    const arg = compile('T = component\n  render\n    code = 42\n    span code\n').code;
    expect(arg).toContain('createTextNode(code)');
  });

  test('factory scopes hoist their locals into the factory `let` (fresh scope per block)', () => {
    const { code } = compile('T = component\n  vis := true\n  render\n    div\n      if vis\n        halved = 4 / 2\n        span\n          = halved\n');
    expect(code).toMatch(/let halved, _el\d+, _t\d+;|let _el\d+, halved, _t\d+;/);
    expect(code).toContain('halved = 4 / 2;');
  });

  test('a DEAD local rejects — the `li = item` intent-collision renders NOTHING in  ()', () => {
    emitFails('T = component\n  items := [1]\n  render\n    ul\n      for item in items\n        li = item\n',
      /render local 'li' is never read/s);
    emitFails('T = component\n  render\n    div = 5\n', /render local 'div' is never read/);
  });

  test('a local read across a factory boundary rejects (each block is its own function;  mints markup or a ReferenceError)', () => {
    emitFails('T = component\n  vis := true\n  render\n    total = 1\n    div\n      = total\n      if vis\n        span\n          = total\n',
      /render local.*ENCLOSING render scope|render local 'total' is not visible here/);
  });

  test('compound assignment to an undeclared name rejects; re-declaring a loop variable rejects', () => {
    emitFails('T = component\n  render\n    x += 2\n    div\n      = x\n', /compound assignment to 'x'/);
    emitFails('T = component\n  items := [1]\n  render\n    for item in items\n      item = 5\n      span\n        = item\n',
      /'item' is a loop variable/);
  });

  test('member/chain writes at child positions reject (no render reading)', () => {
    emitFails('T = component\n  box = {}\n  render\n    div\n      box.x = 5\n', /assignment at a render child position/);
  });
});

describe('two-way binding: the `<=>` matrix and its loudness fork', () => {
  test('the binding matrix: text/number/checkbox/textarea/select — \'s event/accessor cells byte-shaped', () => {
    const { code } = compile([
 'F = component',
 '  name := ""',
 '  qty := 0',
 '  done := false',
 '  bio := ""',
 '  pick := "a"',
 '  render',
 '    input type: "text", value <=> name',
 '    input type: "number", value <=> qty',
 '    input type: "range", value <=> qty',
 '    input type: "checkbox", checked <=> done',
 '    textarea value <=> bio',
 '    select value <=> pick',
 '      option value: "a"',
 '',
    ].join('\n'));
    expect(code).toContain("this._el1.addEventListener('input', (e) => { this.name.value = e.target.value; });");
    expect(code).toContain("this._el2.addEventListener('input', (e) => { this.qty.value = e.target.valueAsNumber; });");
    expect(code).toContain("this._el3.addEventListener('input', (e) => { this.qty.value = e.target.valueAsNumber; });");
    expect(code).toContain("this._el4.addEventListener('change', (e) => { this.done.value = e.target.checked; });");
    expect(code).toContain("this._el5.addEventListener('input', (e) => { this.bio.value = e.target.value; });");
    expect(code).toContain("this._el6.addEventListener('input', (e) => { this.pick.value = e.target.value; });");
    expect(code).toContain('__effect(() => { this._el1.value = this.name.value; });');
    expect(code).toContain('__effect(() => { this._el4.checked = this.done.value; });');
    expect(() => new Function(code)).not.toThrow();
  });

  test('a chain target gets the root container touch (\'s rule); module reactive roots take it too', () => {
    const { code } = compile('F = component\n  history := [{tg: 1}]\n  render\n    input value <=> history[0].tg\n');
    expect(code).toContain("addEventListener('input', (e) => { this.history.value[0].tg = e.target.value; this.history.touch?.(); });");
    const mod = compile('mstate := [{x: 1}]\nF = component\n  render\n    input value <=> mstate[0].x\n').code;
    expect(mod).toContain("addEventListener('input', (e) => { mstate.value[0].x = e.target.value; mstate.touch?.(); });");
  });

  test('`value <=> @name` (the member spelled with @) is a supported spelling', () => {
    const { code } = compile('F = component\n  name := ""\n  render\n    input value <=> @name\n');
    expect(code).toContain("addEventListener('input', (e) => { this.name.value = e.target.value; });");
  });

  test('a bind inside a loop writes the row (no container to touch); the block never goes static', () => {
    const { code } = compile('F = component\n  rows := [{v: "a"}]\n  render\n    for row in rows\n      input value <=> row.v\n');
    expect(code).toContain("addEventListener('input', (e) => { row.v = e.target.value; });");
    expect(code).not.toContain('_s: true');
  });

  test('positioned rejections: non-assignable targets, plain members, undeclared names, locals/loop vars, optional links ', () => {
    emitFails('F = component\n  count := 0\n  render\n    input value <=> count + 1\n',
      /needs an assignable target/s);
    emitFails('F = component\n  note = "x"\n  render\n    input value <=> note\n',
      /plain \(`=`\) member/s);
    emitFails('F = component\n  render\n    input value <=> nothing\n',
      /not declared/s);
    emitFails('F = component\n  items := [1]\n  render\n    for item in items\n      input value <=> item\n',
      /cannot target a .*loop variable/);
    emitFails('F = component\n  box := {v: 1}\n  render\n    input value <=> box?.v\n',
      /cannot carry optional links/);
    emitFails('F = component\n  total ~= 1\n  render\n    input value <=> total\n',
      /computed \('~='\) member — a derived value has no writable/);
  });
});

describe('refs: `ref:` captures the live element into a writable state cell', () => {
  test('a static ref writes in _create and clears through _refCleanups (\'s exact lines)', () => {
    const { code } = compile('T = component\n  el := null\n  render\n    div ref: el\n      "x"\n');
    expect(code).toContain('this.el.value = this._el0;');
    expect(code).toContain('(this._refCleanups ??= []).push(() => __detachRef(this.el, this._el0));');
  });

  test('a dynamic ref writes in m() after insertion and clears in d(detaching), batched; the swap/reconcile wraps in __batch', () => {
    const cond = compile('T = component\n  vis := true\n  el := null\n  render\n    div\n      if vis\n        span ref: el, "x"\n').code;
    expect(cond).toContain('ctx.el.value = _el2;');
    expect(cond).toContain('if (detaching) __batch(() => {');
    expect(cond).toContain('__detachRef(ctx.el, _el2);');
    expect(cond).toContain('__batch(() => {');
    const loop = compile('T = component\n  items := [1]\n  el := null\n  render\n    for item in items\n      span ref: el\n        = item\n').code;
    expect(loop).toContain('__batch(() => __reconcile(');
    expect(() => new Function(cond)).not.toThrow();
  });

  test('ref targets validate: computed/readonly/unknown members and non-identifier values reject with \'s messages', () => {
    emitFails('T = component\n  c ~= 1\n  render\n    div ref: c\n', /not a writable state cell.*declare it with ':='/s);
    emitFails('T = component\n  k =! 1\n  render\n    div ref: k\n', /not a writable state cell/);
    emitFails('T = component\n  render\n    div ref: missing\n', /must be a state cell declared with ':='/);
    emitFails('T = component\n  el := null\n  render\n    div ref: "el"\n', /ref: expects a state cell/);
  });
});

describe('transitions: loud or working, never inert ', () => {
  test('a transition on a conditional branch root sets the block handle; the swap animates enter and leave', () => {
    const { code } = compile('T = component\n  vis := true\n  render\n    div\n      if vis\n        span ~fade\n          "hi"\n      else\n        b ~slide\n          "no"\n');
    expect(code).toContain('this._t = "fade";');
    expect(code).toContain('this._t = "slide";');
    expect(code).toContain("__transition(currentBlock._first, currentBlock._t, 'enter', undefined);");
    expect(code).toContain("__transition(leaving._first, leaving._t, 'leave', () => leaving.d(true));");
  });

  test('same-line content after a transition directive separates ', () => {
    const { code } = compile('T = component\n  vis := true\n  render\n    div\n      if vis\n        span ~fade "hi"\n');
    expect(code).toContain('this._t = "fade";');
    expect(code).toContain('createTextNode("hi")');
  });

  test('positioned rejections: static elements, loop bodies, nested positions, non-first roots ', () => {
    emitFails('P = component\n  render\n    div ~fade\n      "x"\n', /transition.*static element/s);
    emitFails('P = component\n  items := [1]\n  render\n    for item in items\n      li ~fade\n        = item\n',
      /loop body/s);
    emitFails('P = component\n  vis := true\n  render\n    if vis\n      div\n        span ~fade\n          "deep"\n',
      /nested position/s);
    emitFails('P = component\n  vis := true\n  render\n    if vis\n      div "first"\n      span ~fade "second"\n',
      /nested position|FIRST top-level element/);
  });
});

// ════════════════════════════════════════════════════════════════════
// Composition: child components, children/slot, extends
// ════════════════════════════════════════════════════════════════════

const KID = 'Kid = component\n  @label := "k"\n  render\n    div\n      = @label\n';

describe('child components: the instantiation protocol', () => {
  test('class mode: \'s protocol lines — placeholders, _children registration, the once-latched lifecycle over the owner seam', () => {
    const { code } = compile(`${KID}App = component
  render
    div
      Kid label: "x"
`);
    expect(code).toContain('{ const __prev = __pushComponent(this); try {');
    expect(code).toContain('this._inst1 = new Kid({ label: "x" });');
    expect(code).toContain('if (this._inst1 && this._inst1._initFailed) {');
    expect(code).toContain("this._el2 = document.createComment('rip:child-init-failed: Kid');");
    // The child's frame AND the component both push around _create —
    // its render effects land on ITS frame, never the parent's.
    expect(code).toContain('{ const __cprev = __pushComponent(this._inst1); const __co = __pushOwner(this._inst1._frame); try {');
    expect(code).toContain('this._el2 = this._inst1._root = this._inst1._create();');
    expect(code).toContain('} finally { __popOwner(__co); __popComponent(__cprev); } }');
    expect(code).toContain('(this._children || (this._children = [])).push(this._inst1);');
    expect(code).toContain("console.error('[Rip] Kid construction failed:', __childErr);");
    expect(code).toContain("this._el2 = document.createComment('rip:child-error: Kid');");
    expect(code).toContain('} finally { __popComponent(__prev); } }');
    expect(code).toContain('this._el0.appendChild(this._el2);');
    // The lifecycle latch in _setup: beforeMount → _setup → mounted,
    // once, with the child current on BOTH stacks.
    expect(code).toContain(
 'if (this._inst1 && !this._inst1._isSetup) { this._inst1._isSetup = true; ' +
 'const __cprev = __pushComponent(this._inst1); const __co = __pushOwner(this._inst1._frame); try { ' +
 'try { if (this._inst1.beforeMount) this._inst1.beforeMount(); if (this._inst1._setup) this._inst1._setup(); ' +
 'if (this._inst1.mounted) this._inst1.mounted(); } catch (__e) { __handleComponentError(__e, this._inst1); } ' +
 '} finally { __popOwner(__co); __popComponent(__cprev); } }');
    expect(() => new Function(code)).not.toThrow();
  });

  test('factory mode: the minted kids array — construction in c(), the latch in p(), unmount in d() BEFORE the frame dies', () => {
    const { code } = compile(`${KID}App = component
  vis := true
  items := [1, 2]
  render
    div
      if vis
        Kid label: "in-cond"
      for item in items
        Kid label: "row"
`);
    expect(code).toContain('let _factoryChildren = [];');
    expect(code).toContain('{ const __prev = __pushComponent(ctx); try {');
    expect(code).toContain('_inst2 = new Kid({ label: "in-cond" });');
    expect(code).toContain('_factoryChildren.push(_inst2);');
    expect(code).toContain(
 'for (const __c of _factoryChildren) { try { __c.unmount?.({removeDOM: detaching}); } catch (__e) { ' +
      "console.error('[Rip] factory child unmount error:', __e); } }");
    expect(code).toContain('_factoryChildren = [];');
    // The latch rides p() (under the patch-frame push), so a
    // child-bearing block is never static.
    expect(code).toMatch(/p\(ctx\) \{\n\s+if \(__fr\) __fr\.dispose\(\);[\s\S]*?_inst2\._isSetup/);
    expect(code).not.toMatch(/_s: true[\s\S]*?_factoryChildren\.push/);
    // d() unmounts kids FIRST, then disposes the frame.
    expect(code).toMatch(/d\(detaching\) \{\n\s+for \(const __c of _factoryChildren\)[\s\S]{0,220}__fr\.dispose\(\)/);
    expect(() => new Function(code)).not.toThrow();
  });

  test('the constructor reference resolves: module binding bare, member through the instance (#149 graduated), loop variable bare (dynamic components)', () => {
    const member = compile('A = component\n  Badge = component\n    render\n      span "b"\n  render\n    div\n      Badge\n').code;
    expect(member).toContain('this._inst1 = new this.Badge({});');
    const loopVar = compile('A = component\n  kinds := []\n  render\n    div\n      for Widget in kinds\n        Widget label: "w"\n').code;
    expect(loopVar).toContain('_inst2 = new Widget({ label: "w" });');
    const reactive = compile('A = component\n  Face := null\n  render\n    div\n      Face\n').code;
    expect(reactive).toContain('this._inst1 = new this.Face.value({});');
  });

  test('an unresolvable component name rejects positioned — the compile-knowable half ', () => {
    const err = emitFails('App = component\n  render\n    div\n      Buttonz label: "x"\n',
      /component 'Buttonz' is not defined in this module/s);
    expect(err.start).toBeGreaterThan(0);
    // An import binds the name — no rejection.
    const { code } = compile("import { Kid } from './kid.js'\nApp = component\n  render\n    div\n      Kid label: \"x\"\n");
    expect(code).toContain('new Kid({ label: "x" });');
  });

  test('the construction-failure identity threads the MEMBER name for nested declarations ', () => {
    const { code } = compile('A = component\n  Badge = component\n    render\n      span "b"\n  render\n    div\n      Badge\n');
    expect(code).toContain("document.createComment('rip:child-init-failed: Badge')");
    expect(code).toContain("console.error('[Rip] Badge construction failed:', __childErr);");
  });

  test('a child component as a render root returns its element; the parent data-part never lands on the child\'s DOM', () => {
    const { code } = compile(`${KID}App = component
  render
    Kid label: "root"
`);
    expect(code).toContain('return this._el1;');
    // App renders ONLY the child — no element of App's own exists to
    // carry data-part 'App' (the child's render carries 'Kid').
    expect(code).not.toContain("'data-part', 'App'");
  });

  test('the protocol scaffold consts mint against module-level __ names the props spell ', () => {
    const { code } = compile('__prev = 9\nKid = component\n  @label := "k"\n  render\n    div "k"\nApp = component\n  render\n    div\n      Kid label: __prev\n');
    expect(code).toContain('{ const __prev_ = __pushComponent(this); try {');
    expect(code).toContain('new Kid({ label: __prev });');
    expect(() => new Function(code)).not.toThrow();
  });
});

describe('child components: props — the pinned contract', () => {
  test('a bare reactive member passes its CONTAINER (no updater); expressions snapshot with an _updateProp effect ', () => {
    const { code } = compile(`${KID}App = component
  name := "n"
  render
    div
      Kid label: name
      Kid label: (name + "!")
`);
    expect(code).toContain('new Kid({ label: this.name });');
    expect(code).toContain('new Kid({ label: (this.name.value + "!") });');
    // ONE updater — the expression's; the container pass has none.
    const updaters = code.match(/_updateProp\('label',/g);
    expect(updaters).toHaveLength(1);
    expect(code).toContain("__effect(() => { if (this._inst3) this._inst3._updateProp('label', (this.name.value + \"!\")); });");
  });

  test('a bare MODULE-level reactive name shares its container too — the rule one level up ', () => {
    const { code } = compile(`mname := "m"\n${KID}App = component
  render
    div
      Kid label: mname
`);
    expect(code).toContain('new Kid({ label: mname });');
    expect(code).not.toContain('_updateProp');
  });

  test('a loop-variable prop over a reactive collection drives the updater in p() — reused keyed blocks re-prop their children (#168;  is stale)', () => {
    const { code } = compile(`${KID}App = component
  items := [{id: 1, t: "a"}]
  render
    div
      for item in items
        Kid key: item.id, label: item.t
`);
    expect(code).toContain('_inst2 = new Kid({ label: item.t });');
    expect(code).toContain("__effect(() => { if (_inst2) _inst2._updateProp('label', item.t); });");
    // The key extracted into the keyFn — never a constructor prop.
    expect(code).toContain('(item, i) => item.id);');
    expect(code).not.toContain('key: item.id }');
  });

  test('computed members pass their container (\'s reactiveMembers rule); readonly and plain members snapshot', () => {
    const { code } = compile(`${KID}App = component
  count := 1
  total ~= count * 2
  limit =! 9
  note = "plain"
  render
    div
      Kid label: total
      Kid label: limit
      Kid label: note
`);
    expect(code).toContain('new Kid({ label: this.total });');
    expect(code).toContain('new Kid({ label: this.limit });');
    expect(code).toContain('new Kid({ label: this.note });');
  });

  test('`label <=> name` passes the container under the __bind_ key (the `<=>`-as-sugar contract); @name spells the same member', () => {
    const a = compile(`${KID}App = component
  name := "n"
  render
    Kid label <=> name
`).code;
    expect(a).toContain('new Kid({ __bind_label__: this.name });');
    expect(a).not.toContain('_updateProp');
    const b = compile(`${KID}App = component
  name := "n"
  render
    Kid label <=> @name
`).code;
    expect(b).toContain('new Kid({ __bind_label__: this.name });');
  });

  test('`<=>` on a child rejects the statically-dead containers: plain members, undeclared names ', () => {
    emitFails(`${KID}App = component
  note = "p"
  render
    Kid label <=> note
`, /'note' is a plain member.*declare it with ':='/s);
    emitFails(`${KID}App = component
  render
    Kid label <=> nowhere
`, /'nowhere' is not declared/);
    emitFails(`${KID}App = component
  note = "p"
  render
    Kid label <=> @note
`, /'@note' is not a reactive member/);
  });

  test('a loop-variable `<=>` RHS passes through raw (row data may hold a container — statically unknowable, \'s reading)', () => {
    const { code } = compile(`${KID}App = component
  cells := []
  render
    div
      for cell in cells
        Kid label <=> cell
`);
    expect(code).toContain('_inst2 = new Kid({ __bind_label__: cell });');
  });

  test('boolean-prop shorthand: a bare word resolving to nothing is `word: true` (inline and indented; \'s scope rule)', () => {
    const { code } = compile(`${KID}App = component
  render
    Kid outline, label: "x"
      compact
`);
    expect(code).toContain('new Kid({ outline: true, label: "x", compact: true });');
  });

  test('quoted and data- keys ride as quoted object keys; a reactive one updates through the UNQUOTED name', () => {
    const { code } = compile(`${KID}App = component
  n := 1
  render
    Kid "data-x": n + 1
`);
    expect(code).toContain('new Kid({ "data-x": (this.n.value + 1) });');
    expect(code).toContain("_updateProp('data-x', (this.n.value + 1));");
  });

  test('positioned rejections: `ref:`, transitions, and non-loop-root `key:` on a child component ', () => {
    emitFails(`${KID}App = component
  el := null
  render
    Kid ref: el
`, /`ref:` captures ELEMENTS/s);
    emitFails(`${KID}App = component
  vis := true
  render
    div
      if vis
        Kid ~fade
`, /transition directive has no child-component reading/s);
    emitFails(`${KID}App = component
  render
    Kid key: 1
`, /`key:` identifies loop rows/s);
  });

  test('a cross-scope render local read in a prop value rejects (the F2 class holds on component positions)', () => {
    emitFails(`${KID}App = component
  vis := true
  render
    x = 5
    div
      if vis
        Kid label: x
`, /reads a render local of an ENCLOSING render scope/);
  });

  test('duplicate prop keys reject positioned — one key, one writer ', () => {
    // The plain duplicate.
    emitFails(`${KID}App = component
  render
    Kid label: "a", label: "b"
`, /duplicate prop 'label'/s);
    // Quoted and unquoted spellings are ONE JS property.
    emitFails(`${KID}App = component
  render
    Kid label: "a", "label": "b"
`, /duplicate prop 'label'/);
    // A bind and a plain prop of one name write the same member.
    emitFails(`${KID}App = component
  name := "n"
  render
    Kid label: "a", label <=> name
`, /duplicate prop 'label'/);
    // Boolean shorthand collides with an explicit pair.
    emitFails(`${KID}App = component
  render
    Kid compact, compact: 1
`, /duplicate prop 'compact'/);
    // The decisive extends cell (F1): the first key's updater effect
    // and the second's rest application would be TWO live writers.
    emitFails(`Btn = component extends button
  render
    button "b"
App = component
  a := "A"
  b := "B"
  render
    Btn title: (a + "!"), title: b
`, /duplicate prop 'title'/);
    // Split half: the old runtime emits the duplicate keys verbatim.
    const dup = 'Kid = component\n  @label := "k"\n  render\n    div "k"\nApp = component\n  render\n    Kid label: "a", label: "b"\n';
  });

  test('explicit `children:` beside element-body content rejects naming the spellings; alone it passes through (\'s reading)', () => {
    emitFails(`Card = component
  render
    div
      slot
App = component
  render
    Card children: "explicit"
      p "body"
`, /receives `children` TWICE/s);
    emitFails(`Card = component
  render
    div
      slot
App = component
  render
    Card children: "explicit", "inline"
`, /receives `children` TWICE/);
    const { code } = compile('Card = component\n  render\n    div\n      slot\nApp = component\n  render\n    Card children: "explicit"\n');
    expect(code).toContain('new Card({ children: "explicit" });');
  });

  test('a bare TEMPLATE-TAG word rejects whatever it resolves to', () => {
    // Module-bound (hoisted and exported spellings): the old runtime renders TEXT.
    emitFails('div = "TEXT"\nCard = component\n  render\n    section\n      slot\nApp = component\n  render\n    Card div\n',
      /bare 'div' under a child component is ambiguous/s);
    emitFails('export div = "TEXT"\nCard = component\n  render\n    section\n      slot\nApp = component\n  render\n    Card div\n',
      /bare 'div' under a child component is ambiguous/);
    // Render locals and loop variables keep the shadow-to-text rule.
    const loopVar = compile('Card = component\n  render\n    section\n      slot\nApp = component\n  items := ["x"]\n  render\n    section\n      for div in items\n        Card div\n').code;
    expect(loopVar).toContain('_t0 = document.createTextNode(');
    expect(loopVar).not.toContain('div: true');
    // A module-bound NON-tag word is a text child too (the in-scope
    // rule; the unbound spelling stays boolean shorthand).
    const bound = compile('export compact = "c"\nCard = component\n  render\n    section\n      slot\nApp = component\n  render\n    Card compact\n').code;
    expect(bound).toContain('document.createTextNode(compact)');
    expect(bound).not.toContain('compact: true');
  });

  test('a class-scope render local in a REACTIVE prop value rejects (the updater lives in _setup;  ships the mount ReferenceError)', () => {
    emitFails(`${KID}App = component
  n := 1
  render
    x = 5
    Kid label: x + n
`, /render local cannot appear in a LIVE binding/);
  });
});

describe('child components: children and slot', () => {
  test('indented children build in the parent scope and pass as ONE `children:` prop; several ride a fragment', () => {
    const { code } = compile(`Card = component
  render
    div.card
      slot
App = component
  render
    Card
      p "hello"
      p "world"
`);
    expect(code).toContain('this._frag2 = document.createDocumentFragment();');
    expect(code).toContain('this._frag2.appendChild(this._el3);');
    expect(code).toContain('this._frag2.appendChild(this._el4);');
    expect(code).toContain('new Card({ children: this._frag2 });');
    // ONE children key.
    expect(code.match(/children:/g)).toHaveLength(1);
  });

  test('a single child passes directly (\'s shape); inline text children keep \'s bytes — no String() wrap, reactive binds live', () => {
    const single = compile('Card = component\n  render\n    div\n      slot\nApp = component\n  render\n    Card "just text"\n').code;
    expect(single).toContain('this._t0 = document.createTextNode("just text");');
    expect(single).toContain('new Card({ children: this._t0 });');
    const live = compile('Card = component\n  render\n    div\n      slot\nApp = component\n  v := 1\n  render\n    Card v\n').code;
    expect(live).toContain("this._t0 = document.createTextNode('');");
    expect(live).toContain('__effect(() => { this._t0.data = this.v.value; });');
    expect(live).toContain('new Card({ children: this._t0 });');
  });

  test('mixed inline text + indented children merge into ONE fragment ', () => {
    const { code } = compile('Card = component\n  render\n    div\n      slot\nApp = component\n  render\n    Card "inline"\n      p "block"\n');
    expect(code.match(/children:/g)).toHaveLength(1);
    expect(code).toContain('document.createDocumentFragment();');
    expect(code).toContain('createTextNode("inline")');
    expect(code).toContain("createElement('p')");
  });

  test('two inline text args both render ', () => {
    const { code } = compile('Card = component\n  render\n    div\n      slot\nApp = component\n  v := 1\n  w := 2\n  render\n    Card v, w\n');
    expect(code).toContain('__effect(() => { this._t0.data = this.v.value; });');
    expect(code).toContain('__effect(() => { this._t1.data = this.w.value; });');
    expect(code.match(/children:/g)).toHaveLength(1);
  });

  test('a bare TEMPLATE-TAG word under a child component rejects as ambiguous ', () => {
    emitFails('Card = component\n  render\n    div\n      slot\nApp = component\n  render\n    Card\n      div\n',
      /bare 'div' under a child component is ambiguous/s);
  });

  test('props, events, and children mix in the indented body (\'s split)', () => {
    const { code } = compile(`Card = component
  @title := "t"
  render
    div
      slot
App = component
  onSave = (e) ->
    e
  render
    Card title: "t"
      compact
      p "child"
      @save: @onSave
`);
    expect(code).toContain('new Card({ title: "t", compact: true, children: this._el2 });');
    expect(code).toContain("addEventListener('save'");
  });

  test('nested child components inside children blocks recurse (a component child of a component)', () => {
    const { code } = compile(`${KID}Card = component
  render
    div
      slot
App = component
  render
    Card
      Kid label: "nested"
`);
    expect(code).toContain('new Kid({ label: "nested" });');
    expect(code).toContain('children: this._el3');
  });

  test('the slot line is \'s exact ternary; factories project through ctx', () => {
    const cls = compile('Card = component\n  render\n    div\n      slot\n').code;
    expect(cls).toContain(
      "this._slot1 = this.children instanceof Node ? this.children : (this.children != null ? " +
      "document.createTextNode(String(this.children)) : document.createComment(''));");
    const fac = compile('Card = component\n  vis := true\n  render\n    div\n      if vis\n        slot\n').code;
    expect(fac).toContain(
      "_slot2 = ctx.children instanceof Node ? ctx.children : (ctx.children != null ? " +
      "document.createTextNode(String(ctx.children)) : document.createComment(''));");
  });

  test('slot is structurally single: a second slot, a loop-row slot, and slot arguments reject positioned ', () => {
    emitFails('Card = component\n  render\n    div\n      slot\n      slot\n', /second `slot` in one render/s);
    emitFails('Card = component\n  items := [1]\n  render\n    div\n      for item in items\n        slot\n',
      /`slot` inside a loop row/s);
    emitFails('Card = component\n  render\n    div\n      slot "fallback"\n', /`slot` takes no arguments/s);
  });
});

describe('child components: events — `emit` reaches the parent\'s `@event:` binding', () => {
  test('an explicit `@save:` binding listens on the child\'s root (\'s exact line); bare directives keep the validation', () => {
    const { code } = compile(`${KID}App = component
  onSave = (e) ->
    e
  render
    Kid @save: @onSave
`);
    expect(code).toContain(
      "if (this._inst0) this._el1.addEventListener('save', (e) => __batch(() => (this.onSave)(e)));");
    // Bare `@save` is not a DOM event — compile parity with the old runtime (p5).
    emitFails(`${KID}App = component
  onSave = (e) ->
    e
  render
    Kid @save
`, /`@save` is not a DOM event/);
  });

  test('the listener param mints against the handler\'s reads ', () => {
    const { code } = compile(`${KID}App = component
  e := 1
  render
    Kid @save: (=> e + 1)
`);
    expect(code).toMatch(/addEventListener\('save', \(e_\) => __batch\(\(\) => \(.*\)\(e_\)\)\)/);
  });

  test('`@emit` is the child→parent channel (the M12-A runtime method); BARE `emit` stays a bare call — \'s own doomed shape, parity', () => {
    const viaMember = compile('Kid = component\n  fire = ->\n    @emit "save", 1\n  render\n    div "k"\n').code;
    expect(viaMember).toContain('return this.emit("save", 1);');
    // the old runtime emits the bare call too — a dispatch-time ReferenceError in
    // BOTH compilers (ordinary JS scope semantics; `emit` is not a
    // member, and capturing it would shadow user module functions).
    const bare = compile('Kid = component\n  fire = ->\n    emit "save", 1\n  render\n    div "k"\n').code;
    expect(bare).toContain('return emit("save", 1);');
  });
});

describe('`extends <tag>`: the rest-forwarding surface', () => {
  test('static __extends + the inherited-target binding lines (\'s order: create, inherited, data-part)', () => {
    const { code } = compile('Btn = component extends button\n  @label := "b"\n  render\n    button\n      = @label\n');
    expect(code).toContain("static __extends = 'button';");
    const created = code.indexOf("this._el0 = document.createElement('button');");
    const bound = code.indexOf('this._inheritedEl = this._el0;');
    const applied = code.indexOf('this._applyRestToInheritedEl();');
    const part = code.indexOf("setAttribute('data-part', 'Btn')");
    expect(created).toBeGreaterThan(-1);
    expect(bound).toBeGreaterThan(created);
    expect(applied).toBeGreaterThan(bound);
    expect(part).toBeGreaterThan(applied);
    // The rest machinery itself is the runtime's — never re-emitted.
    expect(code).not.toContain('_setRestProp(key, value) {');
  });

  test('only the FIRST class-scope element of the tag binds (\'s rule)', () => {
    const { code } = compile('Btn = component extends button\n  render\n    div\n      button "one"\n      button "two"\n');
    expect(code.match(/this\._inheritedEl =/g)).toHaveLength(1);
    expect(code).toContain('this._inheritedEl = this._el1;');
  });

  test('`@rest.disabled` reads through the reactive rest view', () => {
    const { code } = compile('Btn = component extends button\n  render\n    button\n      = @rest.disabled\n');
    expect(code).toContain('this.rest.value.disabled');
  });
});

