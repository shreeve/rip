// A stdlib package serves every `.rip` under it by path, with no exports
// key for it, and not the files under its test tree: the same rule the
// runtime loader applies, pinned at the editor's resolution of an import.
import { test, expect, describe } from 'bun:test';
import { tsgoAvailable, inWorkspace } from './support/harness.mjs';

const PKG = JSON.stringify({ name: 'stdlib-paths', rip: { strict: true } });

describe.skipIf(!tsgoAvailable)('stdlib files resolve by path', () => {
  test('a file under a stdlib package imports by its path, and a file under its test tree does not', async () => {
    await inWorkspace({ 'package.json': PKG }, async (api) => {
      const served = "import { Root } from 'rip/ui/components/dialog.rip'\nimport { rash } from 'rip/app/rash'\nconsole.log Root, rash\n";
      await api.open('app.rip', served);
      await api.until('app.rip', (codes) => !codes.includes(2307));
      const hidden = "import { x } from 'rip/ui/test/browser/serve.rip'\nconsole.log x\n";
      await api.open('hidden.rip', hidden);
      await api.until('hidden.rip', (codes) => codes.includes(2307));
    });
  }, 30000);
});
