#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { run } from '../lib-esm/coffeescript/command.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

run();
