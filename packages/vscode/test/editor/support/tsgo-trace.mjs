// Test-only tap on the server's tsgo-bound traffic. Preloaded into the
// server process (`bun --preload`), it wraps the broker client's notify
// so every notification method lands, one per line, in the file named
// by RIP_TSGO_TRACE. The server's only LspClient is its tsgo child, so
// the file reads as the face traffic — what a probe costs in swaps.
import fs from 'node:fs';
import { LspClient } from '../../../src/tsgo.js';

const trace = process.env.RIP_TSGO_TRACE;
if (trace) {
  const notify = LspClient.prototype.notify;
  LspClient.prototype.notify = function (method, params) {
    fs.appendFileSync(trace, method + '\n');
    return notify.call(this, method, params);
  };
}
