import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const Command = require(join(__dirname, '../lib/coffeescript/command.js'));

export const buildCSOptionParser = Command.buildCSOptionParser;
export const run = Command.run;
export default Command;
