#!/usr/bin/env bun

// Write the declaration beside each typed runtime, src/runtime/<key>.d.ts,
// from the runtime table (src/ts/runtime-decls.js). test/toolchain/
// runtime-decls.test.js asserts byte-equality with the committed files,
// so a table change lands with this script's output in the same commit.
//
// Run: bun run decls

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { relative } from 'path';
import { runtimeDeclarations } from '../src/ts/runtime-decls.js';

let written = 0;
let unchanged = 0;
for (const { path, text } of runtimeDeclarations()) {
  if (existsSync(path) && readFileSync(path, 'utf8') === text) {
    unchanged++;
    continue;
  }
  writeFileSync(path, text);
  written++;
  console.log(`  wrote ${relative(process.cwd(), path)}`);
}
console.log(`decls: ${written} declaration(s) written, ${unchanged} unchanged`);
