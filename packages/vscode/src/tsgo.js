// The TypeScript 7 native language server (tsgo): binary location and a
// minimal LSP client over stdio.
//
// typescript@7's `bin/tsc` is a Node shim that execs the real native
// binary from the platform package (@typescript/typescript-<os>-<arch>).
// We resolve the binary directly so the LSP stdio stream carries no
// extra process layer; the shim remains the fallback.
//
// The client is deliberately small — Content-Length framing, request/
// notification dispatch, and a notification listener — because the Rip
// server needs exactly that and nothing more.
// The vscode-languageserver dependency serves the EDITOR-facing side of
// the Rip server; this module is the tsgo-facing side.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);

export function tsgoBinaryPath() {
  const pkgJson = require.resolve('typescript/package.json');
  const nodeModules = path.resolve(path.dirname(pkgJson), '..');
  const platformPkg = `typescript-${process.platform}-${process.arch}`;
  const binName = process.platform === 'win32' ? 'tsc.exe' : 'tsc';
  const direct = path.join(nodeModules, '@typescript', platformPkg, 'lib', binName);
  if (fs.existsSync(direct)) return direct;
  const shim = path.join(nodeModules, '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  if (fs.existsSync(shim)) return shim;
  throw new Error(
    `tsgo not found: neither ${direct} nor ${shim} exists — run \`bun install\` in packages/vscode`,
  );
}

// Minimal JSON-RPC 2.0 client over child-process stdio with LSP framing.
export class LspClient {
  constructor(command, args, { cwd = process.cwd(), onNotification = null } = {}) {
    this.proc = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.nextId = 1;
    this.pending = new Map();
    this.notificationHandlers = new Map();
    this.serverRequestHandlers = new Map();
    this.onAnyNotification = onNotification;
    this.buffer = Buffer.alloc(0);
    this.dead = false;
    this.proc.stdout.on('data', (chunk) => this.#consume(chunk));
    this.stderr = '';
    this.proc.stderr.on('data', (chunk) => { this.stderr += chunk.toString(); });
    this.exited = new Promise((resolve) => this.proc.on('exit', resolve));
    // A dead server never wedges its consumer: every in-flight request
    // rejects at exit, and later traffic fails fast (request) or drops
    // (notify) instead of writing to a dead stdin.
    this.proc.on('exit', (code) => {
      this.dead = true;
      const err = new Error(`language server exited (code ${code})`);
      for (const entry of this.pending.values()) entry.reject(err);
      this.pending.clear();
    });
    // Between child death and the 'exit' event, a write can hit the
    // closing pipe (EPIPE) — surface it as a log line, never as an
    // uncaught stream error; the 'exit' handler above owns recovery.
    const swallow = (err) => { console.error(`[lsp-client] stream error: ${err.message}`); };
    this.proc.on('error', swallow);
    this.proc.stdin.on('error', swallow);
  }

  #consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString();
      const m = /Content-Length: (\d+)/i.exec(header);
      if (!m) throw new Error(`tsgo framing: no Content-Length in ${JSON.stringify(header)}`);
      const length = Number(m[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString();
      this.buffer = this.buffer.subarray(bodyStart + length);
      this.#dispatch(JSON.parse(body));
    }
  }

  #dispatch(msg) {
    if (msg.id !== undefined && msg.method === undefined) {
      // Response to one of our requests.
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.error) entry.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code, data: msg.error.data }));
      else entry.resolve(msg.result);
    } else if (msg.id !== undefined) {
      // Server-to-client request; answer or refuse so the server never hangs.
      const handler = this.serverRequestHandlers.get(msg.method);
      if (handler) {
        Promise.resolve(handler(msg.params)).then(
          (result) => this.#send({ jsonrpc: '2.0', id: msg.id, result }),
          (err) => this.#send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(err) } }),
        );
      } else {
        this.#send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unhandled server request ${msg.method}` } });
      }
    } else {
      const handler = this.notificationHandlers.get(msg.method);
      if (handler) handler(msg.params);
      this.onAnyNotification?.(msg.method, msg.params);
    }
  }

  #send(msg) {
    if (this.dead || !this.proc.stdin.writable) return;
    const body = Buffer.from(JSON.stringify(msg));
    this.proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.proc.stdin.write(body);
  }

  request(method, params, { timeoutMs = 15000 } = {}) {
    if (this.dead) {
      return Promise.reject(new Error(`language server is not running — ${method} unavailable`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`tsgo request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.#send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) {
    if (this.dead) return;
    this.#send({ jsonrpc: '2.0', method, params });
  }

  onNotification(method, handler) {
    this.notificationHandlers.set(method, handler);
  }

  onServerRequest(method, handler) {
    this.serverRequestHandlers.set(method, handler);
  }

  async stop() {
    if (!this.dead) {
      try {
        await this.request('shutdown', null, { timeoutMs: 3000 });
        this.notify('exit');
      } catch {
        this.proc.kill();
      }
    }
    await this.exited;
  }
}

// The standard handshake for a tsgo session rooted at `rootDir`.
// `serverRequests` (method → handler) registers BEFORE initialize, so
// a server-to-client ask arriving during the handshake already has its
// answer (an unhandled ask gets a -32601 error, which tsgo may cache).
export async function startTsgo(rootDir, { onNotification = null, clientCapabilities = {}, serverRequests = {} } = {}) {
  const client = new LspClient(tsgoBinaryPath(), ['--lsp', '--stdio'], { cwd: rootDir, onNotification });
  for (const [method, handler] of Object.entries(serverRequests)) {
    client.onServerRequest(method, handler);
  }
  const rootUri = 'file://' + rootDir;
  let init;
  try {
    init = await client.request('initialize', {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: path.basename(rootDir) }],
      capabilities: {
        textDocument: {
          hover: { contentFormat: ['markdown', 'plaintext'] },
          publishDiagnostics: { relatedInformation: true },
          diagnostic: {},
          synchronization: { didSave: true },
        },
        workspace: { configuration: true, didChangeWatchedFiles: {} },
        ...clientCapabilities,
      },
    });
  } catch (err) {
    // A failed handshake must not leak a live child (e.g. an initialize
    // timeout with the process still running).
    if (!client.dead) client.proc.kill();
    throw err;
  }
  client.notify('initialized', {});
  return { client, capabilities: init.capabilities, serverInfo: init.serverInfo };
}
