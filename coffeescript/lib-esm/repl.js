import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const Repl = require(join(__dirname, '../coffeescript/repl.js'));

export default Repl;
export const start = Repl.start;
