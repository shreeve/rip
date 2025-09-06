// ESM wrapper for the generated parser
var parserModule, ref;

parserModule = require('./parser');

export var parser = (ref = parserModule.parser) != null ? ref : parserModule;
