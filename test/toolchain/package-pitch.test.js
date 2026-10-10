// The package frame's one-sentence pitch, as a standing gate.
//
// packages/AGENTS.md makes the README's `> **…**` blockquote and the
// package.json `description` the same sentence, trailing period
// included in both, so registries, the README and tooling all say one
// thing. A package whose README has no pitch blockquote is outside the
// frame and is not judged here.
import { test, expect } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const PACKAGES = join(import.meta.dir, '../../packages');

const pitchOf = (readme) => {
  const m = /^> \*\*(.+)\*\*\s*$/m.exec(readme);
  return m ? m[1] : null;
};

test("every package's description is its README pitch, period included", () => {
  const drift = [];
  for (const name of readdirSync(PACKAGES)) {
    const pkgPath = join(PACKAGES, name, 'package.json');
    const readmePath = join(PACKAGES, name, 'README.md');
    if (!existsSync(pkgPath) || !existsSync(readmePath)) continue;
    const pitch = pitchOf(readFileSync(readmePath, 'utf8'));
    if (pitch === null) continue;
    const { description } = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (description !== pitch || !pitch.endsWith('.')) drift.push({ name, description, pitch });
  }
  expect(drift).toEqual([]);
});
