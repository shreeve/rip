
var helpers,
  hasProp = {}.hasOwnProperty;

import * as CoffeeScript from './coffeescript.js';

import fs from 'fs';

import vm from 'vm';

import path from 'path';

helpers = CoffeeScript.helpers;

export var transpile = function(js, options) {
  throw new Error('Transpilation is not yet supported in ESM mode. Compile to JS first, then use Babel separately.');
};

export var compile = function(code, options) {
  if (options != null ? options.transpile : void 0) {
    throw new Error('Transpilation is not supported in ESM mode. Compile to JS first, then use Babel separately.');
  }
  return CoffeeScript.compile(code, options);
};

export var run = function(code, options = {}) {
  var answer, ref;
  answer = CoffeeScript.compile(code, options);
  return (ref = answer.js) != null ? ref : answer;
};

export var coffeeEval = function(code, options = {}) {
  var createContext, isContext, js, k, o, ref, ref1, ref2, sandbox, v;
  if (!(code = code.trim())) {
    return;
  }
  createContext = (ref = vm.Script.createContext) != null ? ref : vm.createContext;
  isContext = (ref1 = vm.isContext) != null ? ref1 : function(ctx) {
    return options.sandbox instanceof createContext().constructor;
  };
  if (options.sandbox != null) {
    if (isContext(options.sandbox)) {
      sandbox = options.sandbox;
    } else {
      sandbox = createContext();
      ref2 = options.sandbox;
      for (k in ref2) {
        if (!hasProp.call(ref2, k)) continue;
        v = ref2[k];
        sandbox[k] = v;
      }
    }
    sandbox.global = sandbox.root = sandbox.GLOBAL = sandbox;
  } else {
    sandbox = global;
  }
  sandbox.__filename = options.filename || 'eval';
  sandbox.__dirname = path.dirname(sandbox.__filename);
  o = {};
  for (k in options) {
    if (!hasProp.call(options, k)) continue;
    v = options[k];
    o[k] = v;
  }
  o.bare = true;
  js = CoffeeScript.compile(code, o);
  if (sandbox === global) {
    return vm.runInThisContext(js);
  } else {
    return vm.runInContext(js, sandbox);
  }
};

export var register = function() {
  throw new Error("register() is not available in ESM mode. Use import syntax instead.");
};

export var _compileRawFileContent = function(raw, filename, options = {}) {
  var answer, err, stripped;
  stripped = raw.charCodeAt(0) === 0xFEFF ? raw.substring(1) : raw;
  options = Object.assign({}, options, {
    filename: filename,
    sourceFiles: [filename]
  });
  try {
    answer = CoffeeScript.compile(stripped, options);
  } catch (error) {
    err = error;
    throw helpers.updateSyntaxError(err, stripped, filename);
  }
  return answer;
};

export var _compileFile = function(filename, options = {}) {
  var raw;
  raw = fs.readFileSync(filename, 'utf8');
  return CoffeeScript._compileRawFileContent(raw, filename, options);
};

export * from './coffeescript.js';

export {
  coffeeEval as eval
};
