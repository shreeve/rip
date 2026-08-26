// The extension-host side of Rip language support: a thin
// vscode-languageclient shell. All language intelligence lives in the
// Rip language server (src/server.js, spawned on Bun by design) —
// document links included (trivia-channel-driven there).
//
// CommonJS on purpose: the VS Code extension host requires the main
// module, and in development the dependencies resolve from this
// package's own node_modules — no bundler in the loop.
//
// Packaging is the one exception: scripts/package.js bundles this file
// and server.js with Bun so the vsix is self-contained (and so it ships
// two files instead of four hundred). The bundle is CommonJS too, with
// `vscode` external because the host injects it. Nothing about running
// from source changes.

const vscode = require('vscode');
const path = require('path');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');

let client;

async function activate(context) {
  // A log channel, not a plain one: with no separate traceOutputChannel,
  // vscode-languageclient falls back to this channel and calls
  // LogOutputChannel-only methods on it (onDidChangeLogLevel).
  const outputChannel = vscode.window.createOutputChannel('Rip', { log: true });
  outputChannel.appendLine('Rip extension activated');

  const serverModule = path.join(context.extensionPath, 'src', 'server.js');

  const serverOptions = {
    run: { command: 'bun', args: [serverModule], transport: TransportKind.stdio },
    debug: { command: 'bun', args: [serverModule], transport: TransportKind.stdio },
  };

  const clientOptions = {
    documentSelector: [{ language: 'rip' }],
    outputChannel,
  };

  client = new LanguageClient('rip', 'Rip Language Server', serverOptions, clientOptions);
  client.start();

  context.subscriptions.push(outputChannel);
}

function deactivate() {
  if (client) return client.stop();
}

module.exports = { activate, deactivate };
