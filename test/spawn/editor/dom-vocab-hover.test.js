// The DOM vocabulary ↔ EDITOR ANSWER pin: every attribute name the render
// DSL accepts, on every tag it accepts it for, in both namespaces, answers
// at its own key.
//
// This closes the direction no other instrument can see. The hover pins judge
// what a CURATED position answers, and the audit's sweep drives every byte
// but judges what an answer SAYS — so a key that answers NOTHING is invisible
// to both by construction, and one that silently stopped answering would cost
// nothing anywhere. Here the denominator is closed the other way: not the
// corpus's bytes but the vocabulary itself, read from src/dom.js's own
// tables. The sibling gate beside this one (dom-vocab-lib) pins the same
// vocabulary against the pinned lib; this pins it against the editor.
//
// The fixtures are GENERATED, never stored, so a table that grows is covered
// the day it grows.
//
// Three spellings per key, because each takes a different emission path: a
// literal keeps the direct call, a plain identifier cannot be proven
// non-nullish and rides the absence fork, and a reactive read emits inside an
// effect — the path a real component almost always takes.
//
// Rides the EXTENDED tier: it spawns the rip editor server per shard.

import { test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeExtended } from '../../support/extended.js';
import { LspClient } from '../../../packages/vscode/src/tsgo.js';
import { HTML_TAGS, SVG_TAGS, attributeNamesFor } from '../../../src/dom.js';
import { flattenHover } from '../../../packages/vscode/src/translate.js';

const SERVER = path.resolve(import.meta.dir, '..', '..', '..', 'packages', 'vscode', 'src', 'server.js');

// Words the render DSL spends on its own channels and statements — never
// attribute or element names in these positions.
const CHANNEL_KEYS = new Set(['ref', 'key', 'slot']);
const CHANNEL_TAGS = new Set(['slot', 'switch', 'var']);

// A hyphenated name lexes bare only on the aria-/data- roads; every other one
// is a quoted key, and its word starts one byte past the quote.
const quoted = (attr) => /-/.test(attr) && !/^(aria|data)-/.test(attr);

function fixtureFor(tag, svg, attrs) {
  const lines = ['v: any = null', '', 'T = component', '  r := null', '  render'];
  if (svg) lines.push('    svg');
  const indent = svg ? '      ' : '    ';
  lines.push(`${indent}${tag}`);
  const positions = [];
  for (const attr of attrs) {
    const spell = quoted(attr) ? `'${attr}'` : attr;
    const character = indent.length + 2 + (quoted(attr) ? 1 : 0);
    for (const [value, spelling] of [["'x'", 'literal'], ['v', 'identifier'], ['@r', 'reactive']]) {
      lines.push(`${indent}  ${spell}: ${value}`);
      positions.push({ line: lines.length - 1, character, attr, spelling });
    }
  }
  return { text: lines.join('\n') + '\n', positions };
}

// What a served answer must be: the `(attribute)` head this road rules, or the
// `(property)` head a property-road key answers through its real access. The
// type must name something, must not spell a face artifact, and must not
// repeat a union arm.
function judge(attr, flat) {
  if (flat === null || flat === '') return 'declines';
  const m = /^\((attribute|property)\) (.+?): (.+)$/.exec(flat);
  if (m === null) return 'unrecognized head';
  const [, , named, type] = m;
  if (/__[A-Za-z]/.test(type)) return 'face artifact in the type';
  const arms = type.split('|').map((a) => a.trim());
  if (new Set(arms).size !== arms.length) return 'repeated union arm';
  const bare = named.replace(/^<[^>]*>\./, '');
  const bridged = (attr === 'class' && bare === 'className') || (attr === 'for' && bare === 'htmlFor');
  if (!bridged && bare.toLowerCase() !== attr.toLowerCase()) return `names ${named}`;
  return null;
}

const flatten = (h) => (h === null ? null : flattenHover(String(h.contents?.value ?? '')));

describeExtended('dom vocabulary ↔ editor answers', () => {
  test('every attribute key answers at its own word, in every spelling', async () => {
    const jobs = [];
    for (const [tags, svg] of [[HTML_TAGS, false], [SVG_TAGS, true]]) {
      for (const tag of tags) {
        if (CHANNEL_TAGS.has(tag)) continue;
        const attrs = attributeNamesFor(tag).filter((a) => !CHANNEL_KEYS.has(a));
        if (attrs.length) jobs.push({ tag, svg, attrs });
      }
    }
    expect(jobs.length).toBeGreaterThan(100);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-vocab-hover-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'rip-vocab-hover' }));
    const width = 6;
    const shards = Array.from({ length: width }, () => []);
    jobs.forEach((job, i) => shards[i % width].push(job));
    const findings = [];
    let probed = 0;

    await Promise.all(shards.map(async (shard, id) => {
      const client = new LspClient('bun', [SERVER, '--stdio'], { onNotification: () => {} });
      client.onServerRequest('workspace/configuration', (p) => (p.items ?? []).map(() => ({})));
      await client.request('initialize', {
        processId: process.pid, rootUri: 'file://' + dir,
        capabilities: { workspace: { configuration: true } },
      });
      client.notify('initialized', {});
      for (const job of shard) {
        const uri = 'file://' + path.join(dir, `${job.svg ? 'svg-' : ''}${job.tag}-${id}.rip`);
        const { text, positions } = fixtureFor(job.tag, job.svg, job.attrs);
        client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'rip', version: 1, text } });
        // No wait after didOpen: the server's hover handler settles the
        // document before answering, so the first probe is served from
        // the opened text. A WINDOW of probes in flight, not one: the wire
        // round-trip is the cost, and the answers are position-independent,
        // so latency must not stack once per key.
        const WINDOW = 32;
        for (let w = 0; w < positions.length; w += WINDOW) {
          const chunk = positions.slice(w, w + WINDOW);
          const flats = await Promise.all(chunk.map((p) => client.request('textDocument/hover', {
            textDocument: { uri }, position: { line: p.line, character: p.character },
          }).then(flatten, () => null)));
          chunk.forEach((p, i) => {
            probed++;
            const why = judge(p.attr, flats[i]);
            if (why !== null) findings.push(`${job.svg ? 'svg:' : ''}${job.tag} ${p.attr} (${p.spelling}) — ${why}`);
          });
        }
        client.notify('textDocument/didClose', { textDocument: { uri } });
      }
      await client.stop();
    }));
    fs.rmSync(dir, { recursive: true, force: true });

    // The population must be the whole vocabulary, or a shortfall would read
    // as full marks.
    expect(probed).toBe(jobs.reduce((n, j) => n + j.attrs.length * 3, 0));
    expect(findings.sort().slice(0, 20)).toEqual([]);
  }, 600_000);
});
