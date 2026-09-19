// Shared fixtures and helpers for the project-model suites (the project
// model / disk hygiene / closure files), over the one editor harness.
//
// One live server session over a real workspace directory; `awaitReady`
// holds the session until the cache revalidation log line arrives
// (startup complete), which the persistent cache pins read. `inSession`
// runs over an EXISTING directory — a restart over the same tree — and
// `inWorkspace` lays one out and removes it after.
import fs from 'node:fs';
import path from 'node:path';
import { makeWorkspace as makeWs, inSession as inHarnessSession, inWorkspace as inHarnessWorkspace } from './harness.mjs';

export { tsgoAvailable } from './harness.mjs';

const SESSION = { capabilities: {}, awaitReady: true };
export const makeWorkspace = (files) => makeWs(files, 'rip-pm-');
export const inSession = (ws, fn) => inHarnessSession(ws, fn, SESSION);
export const inWorkspace = (files, fn) => inHarnessWorkspace(files, fn, { prefix: 'rip-pm-', ...SESSION });

// The .rip mirrors present in a workspace's tree.
export const mirrorPaths = (ws) => {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.name.endsWith('.rip.ts')) out.push(path.join(dir, e.name));
    }
  };
  walk(path.join(ws, '.rip', 'editor'));
  return out;
};
export const mirrorCount = (ws) => mirrorPaths(ws).length;

// A mirror is a declaration-only auto-import stub when every line it
// carries is one, and a COMPILED FACE otherwise. The distinction is what
// the scaling and cache-purge pins are actually about: candidacy is
// workspace-wide, compiling is not.
export const STUB_LINE = /^(export (declare const [A-Za-z_$][\w$]*: any;|type [A-Za-z_$][\w$]* = any;|default _default;|\{\};)|declare const _default: any;)$/;
export const isStub = (text) => text.split('\n').filter(Boolean).every((l) => STUB_LINE.test(l));
export const faceCount = (ws) => mirrorPaths(ws).filter((p) => !isStub(fs.readFileSync(p, 'utf8'))).length;

// ANNOTATED: the gate's ACROSS rule is what carries a dependency's type
// into the importer, and it carries annotations, not inference — so the
// misuse observable these tests share requires the export to be typed.
export const UTIL = 'export answer: number = 42\n';

// The inferred spelling, for the tests whose observable is hover (hover
// answers whatever the face knows, gate or no gate).
export const INFERRED_UTIL = 'export answer = 42\n';

export const APP = 'import { answer } from "./util.rip"\nbad = answer.toUpperCase()\n';
