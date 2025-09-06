
var ext, helpers, i, len, ref,
  hasProp = {}.hasOwnProperty;

import * as CoffeeScript from './coffeescript.js';

import fs from 'fs';

import vm from 'vm';

import path from 'path';

helpers = CoffeeScript.helpers;

export var transpile = function(js, options) {
  var babel;
  try {
    babel = require('@babel/core');
  } catch (error) {
    try {
      babel = require('babel-core');
    } catch (error) {
      throw new Error('To use the transpile option, you must have the \'@babel/core\' module installed');
    }
  }
  return babel.transform(js, options);
};

export var compile = function(code, options) {
  if (options != null ? options.transpile : void 0) {
    options.transpile.transpile = transpile;
  }
  return CoffeeScript.compile(code, options);
};

export var run = function(code, options = {}) {
  var answer, dir, mainModule, ref;
  mainModule = require.main;
  mainModule.filename = process.argv[1] = options.filename ? fs.realpathSync(options.filename) : helpers.anonymousFileName();
  mainModule.moduleCache && (mainModule.moduleCache = {});
  dir = options.filename != null ? path.dirname(fs.realpathSync(options.filename)) : fs.realpathSync('.');
  mainModule.paths = require('module')._nodeModulePaths(dir);
  mainModule.options = options;
  options.filename = mainModule.filename;
  options.inlineMap = true;
  answer = CoffeeScript.compile(code, options);
  code = (ref = answer.js) != null ? ref : answer;
  return mainModule._compile(code, mainModule.filename);
};

export var coffeeEval = function(code, options = {}) {
  var Module, _module, _require, createContext, i, isContext, js, k, len, o, r, ref, ref1, ref2, ref3, sandbox, v;
  if (!(code = code.trim())) {
    return;
  }
  createContext = (ref = vm.Script.createContext) != null ? ref : vm.createContext;
  isContext = (ref1 = vm.isContext) != null ? ref1 : function(ctx) {
    return options.sandbox instanceof createContext().constructor;
  };
  if (createContext) {
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
    if (!(sandbox !== global || sandbox.module || sandbox.require)) {
      Module = require('module');
      sandbox.module = _module = new Module(options.modulename || 'eval');
      sandbox.require = _require = function(path) {
        return Module._load(path, _module, true);
      };
      _module.filename = sandbox.__filename;
      ref3 = Object.getOwnPropertyNames(require);
      for (i = 0, len = ref3.length; i < len; i++) {
        r = ref3[i];
        if (r !== 'paths' && r !== 'arguments' && r !== 'caller') {
          _require[r] = require[r];
        }
      }
      _require.paths = _module.paths = Module._nodeModulePaths(process.cwd());
      _require.resolve = function(request) {
        return Module._resolveFilename(request, _module);
      };
    }
  }
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
  return require('./register');
};

if (require.extensions) {
  ref = CoffeeScript.FILE_EXTENSIONS;
  for (i = 0, len = ref.length; i < len; i++) {
    ext = ref[i];
    (function(ext) {
      var base;
      return (base = require.extensions)[ext] != null ? base[ext] : base[ext] = function() {
        throw new Error(`Use CoffeeScript.register() or require the coffeescript/register module to require ${ext} files.`);
      };
    })(ext);
  }
}

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
