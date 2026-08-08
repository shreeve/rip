// Unit half of the project-model surface: type-import specifier discovery.
import { test, expect } from 'bun:test';
import { typeImportSpecifiers } from '../../src/mirror.js';

test('type import discovery skips literal, comment, property, and identifier bodies', () => {
  const text = [
    `import('./real.rip').Thing`,
    `import /* before */ ( /* argument */ "../other.rip" /* close */ ).Other`,
    `"import('./string-ghost.rip')"`,
    `'import("./single-ghost.rip')"`,
    `unknown /* import('./comment-ghost.rip') */`,
    `unknown # import('./hash-ghost.rip')\n | known`,
    `Ωimport('./identifier-ghost.rip')`,
    `namespace.import('./property-ghost.rip')`,
    `namespace. /* gap */ import('./spaced-property-ghost.rip')`,
  ].join(' | ');
  expect(typeImportSpecifiers(text)).toEqual(['./real.rip', '../other.rip']);
});
