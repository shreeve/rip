// The Schema DSL ( validation scope + 's :model surface):
// kinds :input/:shape/:mixin/:enum/:union/:model — the persistence
// spellings (:model directives, attrs, scopes, hooks, `on:`) are
// :model-only and malformed spellings reject at parse
// time, positioned. Also the FIRST feature runtime through the
// delivery machinery: injected import on toolchain paths,
// inlined-once standalone output, the duplicate-runtime sentinel,
// scope-aware suppression, and the zero-cost gate as a TEST for
// the injection machinery. (The persistence runtime's own delivery
// batteries live in test/runtime-schema-orm.test.js.)
import { test, expect, beforeEach } from 'bun:test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';
import parser from '../../src/parser.js';
import { makeParserLexer, tokenize } from '../../src/lexer.js';
import { emit, stripFace } from '../../src/emitter.js';
import { compile as fullCompile } from '../../src/compile.js';
import { Stores, Mappings } from '../../src/stores.js';

parser.lexer = makeParserLexer();

const compile = (src, opts = {}) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  const out = emit(r, { source: src, ...opts });
  return { ...out, mappings: new Mappings(out.mappings), stores: out.stores, sexpr: r.sexpr };
};

const lexFails = (src, pattern) => expect(() => tokenize(src)).toThrow(pattern);
const emitFails = (src, pattern) => {
  const r = parser.parse(src);
  expect(r.diagnostics).toEqual([]);
  expect(() => emit(r, { source: src })).toThrow(pattern);
};

const v3opts = { skipPreamble: true, skipRuntimes: true, skipDataPart: true };

// Tier 1 declare-in-place is a SANCTIONED divergence from: the compiler
// declares straight-line locals at their first write. unplaced()
// erases declaration placement — hoist lines drop, in-place
// declarations become bare assignments — so byte pins stay focused
// on the feature bytes they exist for.
const unplaced = (code) => code
  .replace(/^[ \t]*let [A-Za-z_$][\w$]*(, [A-Za-z_$][\w$]*)*;\n\n?/gm, '')
  .replace(/^([ \t]*)let ([A-Za-z_$][\w$]*)( = )/gm, '$1$2$3');

// The runtime module, imported ONCE for eval-tier tests (its sentinel
// permits exactly one copy per process; the standalone-copy tests run
// in subprocesses).
const rt = await import('../../src/runtime/schema.js');
const { __schema, SchemaError, __SchemaRegistry, registerCoercer } = rt;

// Compile with delivery 'none' and evaluate against the imported
// runtime — the binding-passing form.
const run = (src, tail) => {
  const { code } = compile(src);
  return new Function('__schema', 'SchemaError', 'registerCoercer', `${code}\n${tail}`)(__schema, SchemaError, registerCoercer);
};

beforeEach(() => __SchemaRegistry.reset());

// ════════════════════════════════════════════════════════════════════
// Byte pins: the emitted __schema({...}) literal is pinned exactly
// (the old lowering compiled with skipRuntimes — its global-bridge preamble is the
// delivery model the contract replaced).
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
// Eval checks: the compiled schemas VALIDATE through the runtime
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
// The DSL's negative battery (all rejections positioned and loud)
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
// the contract delivery: the three paths, suppression, sentinel, zero cost
// ════════════════════════════════════════════════════════════════════

