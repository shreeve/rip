// The generated intrinsic surfaces ↔ pinned-tsc lockstep: every tag's
// declarations (src/ts/dom-types.js) must be valid TypeScript against
// the repo's pinned lib — the whole vocabulary at once, both
// namespaces, ref-cell declares and the class-value alias included. A
// lib upgrade that renames a map key or a property this generation
// reads through fails HERE, before any fixture or app does.
//
// Rides the EXTENDED tier: it spawns the pinned tsc (resolveTsc — the
// native tsgo binary, the same engine the editor broker runs).

import { test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from '../../support/spawn.js';
import { describeExtended } from '../../support/extended.js';
import { resolveTsc } from '../../support/tsc.js';
import { domSurfaceDecls } from '../../../src/ts/dom-types.js';
import { HTML_TAGS, SVG_TAGS } from '../../../src/dom.js';

describeExtended('generated dom surfaces ↔ pinned tsc', () => {
  test('every tag surface in both namespaces compiles clean against the pinned lib', () => {
    const used = [
      ...[...HTML_TAGS].map((tag) => ({ tag, svg: false })),
      ...[...SVG_TAGS].map((tag) => ({ tag, svg: true })),
    ];
    const text = domSurfaceDecls(used, { needsClassValue: true, needsRefCell: true });
    expect(text).toContain('interface __RipEl_div');
    expect(text).toContain('interface __RipEl_svg_circle');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-dom-surfaces-'));
    try {
      fs.writeFileSync(path.join(dir, 'surfaces.ts'), `${text}\nexport {};\n`);
      const r = spawnSync(resolveTsc(), ['--noEmit', '--strict', '--target', 'esnext', '--lib', 'dom,esnext', 'surfaces.ts'], {
        cwd: dir, encoding: 'utf8', timeout: 120_000,
      });
      const errors = (r.stdout ?? '').split('\n').filter((l) => l.includes('error'));
      expect(errors).toEqual([]);
      expect(r.status).toBe(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);
});
