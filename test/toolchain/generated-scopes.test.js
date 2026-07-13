// The generated-scope inventory: every emitter site that puts a
// FUNCTION SCOPE into generated output (an arrow, an IIFE) is listed
// here with its control-capability policy. A generated scope is a
// control-flow boundary — an unguarded one can capture a source
// `yield`/`await` and emit invalid JavaScript (the silent-miscompile
// class), so a new site must (a) preserve the source control context
// without a function boundary, (b) explicitly support async/generator
// behavior, or (c) reject positioned before emitting — and then add
// its row here. A count drift in an existing row means a site was
// added, removed, or reshaped: re-audit its policy before updating.
//
// This test scans COMPILER SOURCE (never generated output — the
// mapping doctrine's no-scanning rule applies to emitted code and its
// mapping facts, not to auditing the emitter itself).
import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dir, '../../src/emitter.js'), 'utf8');

// sig: a byte-exact slice of the emission statement. count: how many
// times it appears. policy: how source control flow is kept legal.
const INVENTORY = [
  { sig: "? 'await (async () => {\\n' : '(() => {\\n'", count: 2,
    site: 'comprehension statement body; array/object comprehension',
    policy: 'await rides the async form; yield/return/bare break/continue reject via rejectYieldInIIFE' },
  { sig: "? 'await (async () => { ' : '(() => { '", count: 3,
    site: 'accumulator loops; comprehension value position; switch expression',
    policy: 'await rides the async form; yield/return/bare break/continue reject via rejectYieldInIIFE' },
  { sig: "? 'await (async () => { throw ' : '(() => { throw '", count: 1,
    site: 'value-position throw',
    policy: 'await rides the async form; yield/return/bare break/continue reject via rejectYieldInIIFE' },
  { sig: "this.b.emit('() => ');", count: 1,
    site: "computed ('~=') lowering",
    policy: 'the computed body rejects both yield and await with its own positioned errors (computeds evaluate synchronously)' },
  { sig: "this.b.emit('(() => { ');", count: 1,
    site: 'class field per-evaluation reference captures',
    policy: 'classFieldValue rejects await/yield before the lexical arrow; each field evaluation owns a fresh activation' },
  { sig: "isAsync ? '(async () => ' : '(() => '", count: 2,
    site: 'effectValue (the statement/expression/tail effect funnel); component-body effects',
    policy: 'await rides the async form; yield rejects — in effectValue for every effect position, and again at component collection (the one path that bypasses the funnel)' },
  { sig: "' = __computed(() => '", count: 1,
    site: 'component computed member',
    policy: 'computedBody applies the same yield/await rejections as the top-level computed lowering' },
  { sig: "'__effect(() => { '", count: 1,
    site: 'render updater effect',
    policy: 'render-wide: findRenderControl rejects await/yield in every render expression at collection; function values pass through with their own context' },
  { sig: '__effect(() => {\\n', count: 2,
    site: 'render if-block and for-block reconciler effects',
    policy: 'emitter-owned statements; embedded user expressions are covered by findRenderControl' },
  { sig: '__batch(() => {\\n', count: 2,
    site: 'render reconciler batch windows (if-block; detach path)',
    policy: 'emitter-owned statements; embedded user expressions are covered by findRenderControl' },
  { sig: "'__batch(() => '", count: 1,
    site: 'render for-block batch window',
    policy: 'emitter-owned statements; embedded user expressions are covered by findRenderControl' },
  { sig: '__ownerFrame().add(() =>', count: 2,
    site: 'render if/for cleanup registrations',
    policy: 'emitter-owned statements only — no user expression embeds' },
  { sig: '() => ${leaving}.d(true)', count: 1,
    site: 'render transition completion callback',
    policy: 'emitter-owned statement only — no user expression embeds' },
  { sig: '() => __detachRef', count: 1,
    site: 'render ref cleanup registration',
    policy: 'emitter-owned statement only — no user expression embeds' },
  { sig: '(${ev}) => __batch(() => (', count: 1,
    site: 'child-component event prop listener',
    policy: 'handler expressions are covered by findRenderControl; function handlers pass through with their own context' },
  { sig: '(${ev}) => __batch(() => `', count: 1,
    site: 'element event listener',
    policy: 'handler expressions are covered by findRenderControl; function handlers pass through with their own context' },
  { sig: '(${ev}) => { ', count: 1,
    site: 'two-way binding write-back listener',
    policy: 'binding targets are covered by findRenderControl' },
  { sig: 'this.b.emit(`(${itemVar}, ${indexVar}) => `);', count: 1,
    site: 'keyed render reconciliation callback',
    policy: 'the key expression is covered by render-wide findRenderControl before the synchronous callback emits' },
  { sig: '((${p}) =>', count: 2,
    site: 'pick with a single-evaluation source (plain and optional forms, one ternary)',
    policy: 'pick defaults reject both yield and await positioned when the source needs the arrow' },
  { sig: '((s, e) => Array.from({length:', count: 2,
    site: 'range value helpers (inclusive and exclusive)',
    policy: 'emitter-owned callbacks receive already-evaluated source operands; no source body or control transfer is embedded' },
  { sig: "static MODULO = '((n, d) =>", count: 1,
    site: 'true-modulo helper',
    policy: 'emitter-owned helper receives source operands as evaluated call arguments; no source body or control transfer is embedded' },
  { sig: 'static MEMBER_IN = "((k, c) =>', count: 1,
    site: 'single-read membership helper',
    policy: 'emitter-owned helper receives source operands as evaluated call arguments; no source body or control transfer is embedded' },
  { sig: 'builder.emit(` = (() => {\\n${unit.body}', count: 1,
    site: 'inline runtime unit wrapper',
    policy: 'wraps repository runtime text, not a source expression; the runtime unit has its own authored function contexts' },
];

// Collect JavaScript string/template literals without depending on line
// numbers or a JavaScript parser package. Template expressions are scanned
// recursively, while their dynamic text normalizes to `${…}` in the owning
// template's signature. Comments and regular-expression bodies are skipped.
// The result is a source-level structural gate: every literal that spells a
// function scope is classified below, including diagnostics and source-function
// emission sites that are deliberately outside the generated-scope inventory.
function scopeLiterals(source, { outputOnly = true } = {}) {
  const found = [];
  let i = 0;

  const quoted = (quote) => {
    const start = i++;
    while (i < source.length) {
      if (source[i] === '\\') { i += 2; continue; }
      if (source[i++] === quote) break;
    }
    found.push({ literal: source.slice(start, i), start });
  };

  const regex = () => {
    i++;
    let inClass = false;
    while (i < source.length) {
      const ch = source[i++];
      if (ch === '\\') { i++; continue; }
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) break;
    }
    while (/[A-Za-z]/.test(source[i] ?? '')) i++;
  };

  const code = (stopAtBrace = false) => {
    let braces = stopAtBrace ? 1 : 0;
    while (i < source.length) {
      const ch = source[i];
      if (ch === "'" || ch === '"') { quoted(ch); continue; }
      if (ch === '`') { template(); continue; }
      if (ch === '/' && source[i + 1] === '/') {
        i += 2;
        while (i < source.length && source[i] !== '\n') i++;
        continue;
      }
      if (ch === '/' && source[i + 1] === '*') {
        i += 2;
        while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
        i += 2;
        continue;
      }
      if (ch === '/') {
        const prev = source.slice(0, i).match(/\S(?=\s*$)/)?.[0] ?? '';
        if (prev === '' || /[({\[=,:;!?&|]/.test(prev)) { regex(); continue; }
      }
      if (stopAtBrace && ch === '{') braces++;
      if (stopAtBrace && ch === '}' && --braces === 0) { i++; return; }
      i++;
    }
  };

  const template = () => {
    const start = i;
    const parts = ['`'];
    i++;
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\') {
        parts.push(source.slice(i, i + 2));
        i += 2;
      } else if (ch === '`') {
        parts.push('`');
        i++;
        found.push({ literal: parts.join(''), start });
        return;
      } else if (ch === '$' && source[i + 1] === '{') {
        parts.push('${…}');
        i += 2;
        code(true);
      } else {
        parts.push(ch);
        i++;
      }
    }
    found.push({ literal: parts.join(''), start });
  };

  code();
  // Include partial arrow/function tokens as well as complete spellings.
  // A scope assembled across several emit() calls must still expose either
  // its `=>` fragment or its `function` keyword to this classification.
  const scopeSpelling = /=>|\bfunction\*?\b/;
  const outputLiteral = ({ start }) => {
    const lineStart = source.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = source.indexOf('\n', start);
    const line = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
    return /\.emit\s*\(/.test(line) ||
      /\bstatic\s+(?:MODULO|MEMBER_IN)\s*=/.test(line) ||
      /[?:]\s*['"]\(\(s,\s*e\)\s*=>/.test(line);
  };
  const scoped = found
    .filter(({ literal }) => scopeSpelling.test(literal.slice(1, -1)))
    .map((item) => ({ ...item, output: outputLiteral(item) }));
  return scoped
    .filter((item) => !outputOnly || item.output)
    .reduce((counts, { literal }) => counts.set(literal, (counts.get(literal) ?? 0) + 1), new Map());
}

const generated = (literal, count, policy) => ({ literal, count, kind: 'generated', policy });
const excluded = (literal, count, reason) => ({ literal, count, kind: 'excluded', reason });

const LITERAL_CLASSIFICATION = [
  generated("' = __computed(() => '", 1, 'component computed body rejects await and yield'),
  generated("'__batch(() => '", 1, 'emitter-owned render batch window'),
  generated("'__effect(() => { '", 1, 'render control is rejected before updater emission'),
  generated("'(() => '", 2, 'effect bodies reject yield and carry await on the async spelling'),
  generated("'(() => { '", 4, 'value lowerings reject captured control; class fields reject await and yield'),
  generated("'(() => { throw '", 1, 'value throw rejects captured control'),
  generated("'(() => {\\n'", 2, 'comprehensions reject captured control'),
  generated("'((n, d) => { n = +n; d = +d; return (n % d + d) % d; })'", 1, 'helper receives evaluated operands as parameters'),
  generated("'((s, e) => Array.from({length: Math.abs(e - s) + 1}, (_, i) => s + (i * (s <= e ? 1 : -1))))'", 1, 'range helper receives evaluated endpoints as parameters'),
  generated("'((s, e) => Array.from({length: Math.max(0, Math.abs(e - s))}, (_, i) => s + (i * (s <= e ? 1 : -1))))'", 1, 'range helper receives evaluated endpoints as parameters'),
  generated("'() => '", 1, 'computed body rejects await and yield'),
  generated("'(async () => '", 2, 'effect bodies carry source await on the async spelling'),
  generated("'await (async () => { '", 3, 'value lowerings carry source await and reject captured control'),
  generated("'await (async () => { throw '", 1, 'value throw carries source await and rejects captured control'),
  generated("'await (async () => {\\n'", 2, 'comprehensions carry source await and reject captured control'),
  excluded("'function '", 2, 'source def emission, including the TS signature face'),
  excluded("'function'", 1, 'source thin-function emission'),
  excluded("'function* '", 1, 'source generator-def emission'),
  excluded("'function*'", 1, 'source generator-function emission'),
  excluded("'=>'", 1, 'source fat-arrow emission'),
  generated(`"((k, c) => Array.isArray(c) || typeof c === 'string' ? c.includes(k) : k in c)"`, 1, 'helper receives evaluated operands as parameters'),
  generated("` = (() => {\\n${…}\\nreturn { ${…} };\\n})();\\n`", 1, 'repository runtime text is wrapped, not a source expression'),
  generated("`((${…}) => ({`", 1, 'pick defaults reject await and yield before capture'),
  generated("`((${…}) => ${…} == null ? undefined : ({`", 1, 'optional pick defaults reject await and yield before capture'),
  generated("`(${…}, ${…}) => `", 1, 'render key expression is synchronously validated before emission'),
  generated("`(this._refCleanups ??= []).push(() => __detachRef(this.${…}, ${…}))`", 1, 'emitter-owned ref cleanup'),
  excluded("`) satisfies () => ${…}`", 1, 'TypeScript function type, erased from generated JavaScript'),
  generated("`${…}  if (${…}._t) { __transition(${…}._first, ${…}._t, 'leave', () => ${…}.d(true)); }\\n`", 1, 'emitter-owned transition callback'),
  generated("`${…}__batch(() => {\\n`", 1, 'emitter-owned render batch window'),
  generated("`${…}__effect(() => {\\n`", 2, 'render control is rejected before reconciler emission'),
  generated("`${…}__ownerFrame().add(() => { for (const ${…} of ${…}.blocks) { try { ${…}.d(true); } catch {} } ${…}.blocks = []; ${…}.keys = []; ${…}.items = []; });\\n`", 1, 'emitter-owned loop cleanup'),
  generated("`${…}__ownerFrame().add(() => { if (${…}) { ${…}.d(true); ${…} = null; } });\\n`", 1, 'emitter-owned conditional cleanup'),
  generated("`${…}.addEventListener('${…}', (${…}) => __batch(() => `", 1, 'render handler control is validated before listener emission'),
  generated("`${…}.addEventListener('${…}', (${…}) => { `", 1, 'binding target control is validated before listener emission'),
  generated("`${…}if (detaching) __batch(() => {\\n`", 1, 'emitter-owned detach batch window'),
  generated("`if (${…}) ${…}.addEventListener('${…}', (${…}) => __batch(() => (`", 1, 'render handler control is validated before listener emission'),
].sort((a, b) => a.literal.localeCompare(b.literal));

describe('generated-scope inventory', () => {
  for (const row of INVENTORY) {
    test(`${row.site} — ${row.sig.slice(0, 40)}`, () => {
      expect(src.split(row.sig).length - 1).toBe(row.count);
    });
  }

  test('every scope-like emitter literal has an auditable classification', () => {
    const discovered = [...scopeLiterals(src)]
      .map(([literal, count]) => ({ literal, count }))
      .sort((a, b) => a.literal.localeCompare(b.literal));
    expect(discovered).toEqual(LITERAL_CLASSIFICATION.map(({ literal, count }) => ({ literal, count })));
    for (const row of LITERAL_CLASSIFICATION) {
      if (row.kind === 'generated') expect(row.policy.length).toBeGreaterThan(0);
      else expect(row.reason).toMatch(/source|TypeScript/);
    }
  });

  test('indirect scope-like literals cannot bypass the output-site collector', () => {
    const all = scopeLiterals(src, { outputOnly: false });
    const output = scopeLiterals(src);
    const nonOutput = [...all].flatMap(([literal, count]) => {
      const left = count - (output.get(literal) ?? 0);
      return left > 0 ? [{ literal, count: left }] : [];
    });
    const categories = { diagnostic: 0, semantic: 0, type: 0 };
    const unknown = [];
    for (const row of nonOutput) {
      const text = row.literal.slice(1, -1);
      if (row.literal === "'function'" || row.literal === "'=>'" ||
          row.literal === "'(function() {})'" || row.literal === "'(function('" ||
          /^\`\(\$\{…\}function\$\{…\}\(\`$/.test(row.literal)) {
        categories.semantic += row.count;
      }
      else if (/emitter:|schema: failed|requires a function|function target|make the handler|into a member/.test(text)) {
        categories.diagnostic += row.count;
      } else if (/factory function/.test(text)) {
        categories.diagnostic += row.count;
      } else if (/=>/.test(text) &&
          /(?:\bany\b|:\s*(?:number|string|never|void|T\b)|=>\s*void|<T>|Promise<|AbortSignal|readonly value)/.test(text)) {
        categories.type += row.count;
      } else {
        unknown.push(row);
      }
    }
    expect(unknown).toEqual([]);
    expect(categories).toEqual({ diagnostic: 36, semantic: 20, type: 25 });
  });
});
