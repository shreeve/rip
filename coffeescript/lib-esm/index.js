// ESM wrapper that re-exports the CommonJS API for ESM consumers.
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const CoffeeScript = require(join(__dirname, '../coffeescript/index.js'));

export default CoffeeScript;
export const VERSION = CoffeeScript.VERSION;
export const FILE_EXTENSIONS = CoffeeScript.FILE_EXTENSIONS;
export const helpers = CoffeeScript.helpers;
export const registerCompiled = CoffeeScript.registerCompiled;
export const compile = CoffeeScript.compile;
export const tokens = CoffeeScript.tokens;
export const nodes = CoffeeScript.nodes;
export const register = CoffeeScript.register;
export const eval_ = CoffeeScript.eval; // 'eval' is reserved; provide alias if needed
export const run = CoffeeScript.run;
export const transpile = CoffeeScript.transpile;
export const patchStackTrace = CoffeeScript.patchStackTrace;
export const _compileRawFileContent = CoffeeScript._compileRawFileContent;
export const _compileFile = CoffeeScript._compileFile;
