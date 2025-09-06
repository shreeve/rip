var CoffeeScript, Module, binary, cacheSourceMaps, child_process, ext, findExtension, fork, getRootModule, helpers, i, len, loadFile, nodeSourceMapsSupportEnabled, patchStackTrace, path, ref, ref1;

CoffeeScript = require('./');

child_process = require('child_process');

helpers = require('./helpers');

path = require('path');

({patchStackTrace} = CoffeeScript);

nodeSourceMapsSupportEnabled = (typeof process !== "undefined" && process !== null) && (process.execArgv.includes('--enable-source-maps') || ((ref = process.env.NODE_OPTIONS) != null ? ref.includes('--enable-source-maps') : void 0));

if (!(Error.prepareStackTrace || nodeSourceMapsSupportEnabled)) {
  cacheSourceMaps = true;
  patchStackTrace();
}

loadFile = function(module, filename) {
  var js, options;
  options = module.options || getRootModule(module).options || {};
  if (cacheSourceMaps || nodeSourceMapsSupportEnabled) {
    options.inlineMap = true;
  }
  js = CoffeeScript._compileFile(filename, options);
  return module._compile(js, filename);
};

if (require.extensions) {
  ref1 = CoffeeScript.FILE_EXTENSIONS;
  for (i = 0, len = ref1.length; i < len; i++) {
    ext = ref1[i];
    require.extensions[ext] = loadFile;
  }
  Module = require('module');
  findExtension = function(filename) {
    var curExtension, extensions;
    extensions = path.basename(filename).split('.');
    if (extensions[0] === '') {
      extensions.shift();
    }
    while (extensions.shift()) {
      curExtension = '.' + extensions.join('.');
      if (Module._extensions[curExtension]) {
        return curExtension;
      }
    }
    return '.js';
  };
  Module.prototype.load = function(filename) {
    var extension;
    this.filename = filename;
    this.paths = Module._nodeModulePaths(path.dirname(filename));
    extension = findExtension(filename);
    Module._extensions[extension](this, filename);
    return this.loaded = true;
  };
}

if (child_process) {
  ({fork} = child_process);
  binary = require.resolve('../../bin/coffee');
  child_process.fork = function(path, args, options) {
    if (helpers.isCoffee(path)) {
      if (!Array.isArray(args)) {
        options = args || {};
        args = [];
      }
      args = [path].concat(args);
      path = binary;
    }
    return fork(path, args, options);
  };
}

getRootModule = function(module) {
  if (module.parent) {
    return getRootModule(module.parent);
  } else {
    return module;
  }
};
