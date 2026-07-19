// The DOM vocabulary ↔ TypeScript lib pin. The emitter types event
// handler parameters as `HTMLElementEventMap['<event>']` — a BARE
// indexed access, emitted whenever the event name is in DOM_EVENTS
// (src/dom-vocab.js). Membership is the only guard: a vocabulary name
// missing from the pinned lib's map would put a face error (TS2339 on
// the index) on every handler bound to that event, at a position no
// source line owns. This gate compiles one indexed access per
// vocabulary name against the repo's pinned TypeScript, so the
// vocabulary can never outgrow the lib silently — on a TS upgrade
// that drops or renames a map key, this fails before any fixture
// does.
//
// Rides the EXTENDED tier: it spawns the pinned tsc (resolveTsc — the
// native tsgo binary, the same engine the editor broker runs).

import { test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DOM_EVENTS } from '../../src/dom-vocab.js';
import { describeExtended } from '../support/extended.js';
import { resolveTsc } from '../support/tsc.js';

describeExtended('dom vocabulary ↔ lib pin', () => {
  test('every DOM_EVENTS name indexes HTMLElementEventMap in the pinned lib', () => {
    const names = [...DOM_EVENTS].sort();
    expect(names.length).toBeGreaterThan(0);
    const lines = names.map((n, i) => `type _E${i} = HTMLElementEventMap['${n}'];`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-dom-vocab-'));
    try {
      fs.writeFileSync(path.join(dir, 'probe.ts'), lines.join('\n') + '\n');
      const r = spawnSync(resolveTsc(), ['--noEmit', '--lib', 'es2022,dom', 'probe.ts'], {
        cwd: dir, encoding: 'utf8', timeout: 60_000,
      });
      // Name the offending event(s), not just the tsc exit.
      const bad = (r.stdout ?? '').split('\n').filter((l) => l.includes('error')).map((l) => {
        const m = l.match(/probe\.ts[:(](\d+)/);
        return m ? `${names[Number(m[1]) - 1]} — ${l.trim()}` : l.trim();
      });
      expect(bad).toEqual([]);
      expect(r.status).toBe(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});
