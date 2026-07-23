// The activation contract: the chain VS Code walks to get from "user opened a
// .rip file" to "the language server is running."
//
//   manifest.contributes.languages  →  the id `rip`, bound to `.rip`
//     (VS Code >= 1.74 auto-generates the onLanguage:rip activation event
//      from this contribution — no explicit activationEvents entry needed)
//   manifest.main  →  extension.js, exporting activate()
//   activate()  →  spawns src/server.js on bun, over stdio, for rip documents
//
// Every OTHER test in this package imports `server.js` directly, so a broken
// link anywhere in that chain is invisible to all of them: the server can be
// perfect, every editor feature green, and the extension still dead on arrival
// because the manifest names a file that moved or the language id drifted (the
// contribution VS Code derives the activation event from).
//
// activate() is RUN here, against a stubbed extension host, and the values it
// hands the language client are inspected. Grepping its source instead would
// redden on a reformat — a quote style, a path hoisted into a const — while the
// chain was perfectly intact, which is a false alarm in the one gate that has
// to be trustworthy.
//
// What this does NOT claim: that VS Code renders anything. Loading the .vsix
// into a real window and seeing a squiggle is the one check a human still owns.
import { describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.join(HERE, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'));

const EXT_PATH = '/fake/extension/path';       // what the host passes as context.extensionPath
const STDIO = 'stdio-transport-sentinel';

// Load the entry point the way the extension host does — CommonJS require —
// with `vscode` stubbed (it exists only inside the host) and the language
// client captured. Everything else resolves for real.
function loadExtension() {
  const src = fs.readFileSync(path.join(PKG_DIR, pkg.main), 'utf8');
  const captured = {};

  const vscodeStub = {
    window: { createOutputChannel: () => ({ appendLine() {}, dispose() {} }) },
  };
  const clientStub = {
    LanguageClient: class {
      constructor(id, name, serverOptions, clientOptions) {
        Object.assign(captured, { id, name, serverOptions, clientOptions });
      }
      start() { captured.started = true; }
      stop() { captured.stopped = true; }
    },
    TransportKind: { stdio: STDIO },
  };

  const shim = (id) => {
    if (id === 'vscode') return vscodeStub;
    if (id === 'vscode-languageclient/node') return clientStub;
    return createRequire(path.join(PKG_DIR, 'package.json'))(id);   // path, etc.
  };

  const module_ = { exports: {} };
  new Function('require', 'module', 'exports', src)(shim, module_, module_.exports);
  return { mod: module_.exports, captured };
}

describe('the extension activation contract', () => {
  test('activation is auto-generated from the language contribution — no redundant onLanguage:rip', () => {
    // VS Code (>= 1.74; we require ^1.80) generates the `onLanguage:rip`
    // activation event from the `contributes.languages` entry below, so an
    // explicit `onLanguage:rip` in `activationEvents` is redundant and the
    // manifest linter flags it. This guards that specific entry from creeping
    // back; other activation events, if ever genuinely needed, stay fine.
    expect(pkg.activationEvents ?? []).not.toContain('onLanguage:rip');
  });

  test('the rip language is contributed and bound to .rip', () => {
    const rip = (pkg.contributes?.languages ?? []).find((l) => l.id === 'rip');
    expect(rip).toBeDefined();
    expect(rip.extensions).toContain('.rip');
    // Referenced by path — a rename is a silent break, so resolve it.
    expect(fs.existsSync(path.join(PKG_DIR, rip.configuration))).toBe(true);
  });

  test('main resolves to an entry point exporting activate/deactivate', () => {
    expect(fs.existsSync(path.join(PKG_DIR, pkg.main))).toBe(true);
    const { mod } = loadExtension();
    expect(typeof mod.activate).toBe('function');
    expect(typeof mod.deactivate).toBe('function');
  });

  test('activate() spawns the server that every other test drives directly', async () => {
    const { mod, captured } = loadExtension();
    await mod.activate({ extensionPath: EXT_PATH, subscriptions: [] });

    // The path the shipped extension will actually spawn. If server.js is
    // renamed or moved, every LSP test in this package keeps passing — they
    // import it by module path — while the extension launches nothing.
    const serverModule = captured.serverOptions.run.args.at(-1);
    expect(serverModule).toBe(path.join(EXT_PATH, 'src', 'server.js'));
    // …and that file exists where the manifest's entry point looks for it.
    expect(fs.existsSync(path.join(PKG_DIR, 'src', 'server.js'))).toBe(true);

    // On bun, over stdio, scoped to rip documents; and actually started.
    expect(captured.serverOptions.run.command).toBe('bun');
    expect(captured.serverOptions.run.transport).toBe(STDIO);
    expect(captured.clientOptions.documentSelector).toContainEqual({ language: 'rip' });
    expect(captured.started).toBe(true);
  });

  test('the language client dependency is declared (the host resolves it from this package)', () => {
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    expect(deps['vscode-languageclient']).toBeDefined();
  });
});
