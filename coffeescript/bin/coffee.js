#!/usr/bin/env node

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const potentialPaths = [
  join(process.cwd(), 'node_modules/rip/lib/coffeescript'),
  join(process.cwd(), 'node_modules/coffeescript/lib/coffeescript'),
  join(__dirname, '../lib/coffeescript')
];

for (const base of potentialPaths) {
  const target = join(base, '../lib-esm/command.js');
  const targetCJS = join(base, 'command.cjs');
  if (existsSync(targetCJS)) {
    const mod = await import(pathToFileURL(targetCJS).href);
    const api = mod?.run ? mod : mod?.default;
    if (api?.run) {
      await api.run();
      break;
    }
  } else if (existsSync(target)) {
    const mod = await import(pathToFileURL(target).href);
    const api = mod?.run ? mod : mod?.default;
    if (api?.run) {
      await api.run();
      break;
    }
  }
}
