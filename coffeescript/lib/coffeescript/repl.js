var addHistory, addMultilineHandler, getCommandId, replDefaults, runInContext, sawSIGINT, transpile;

import fs from 'fs';

import path from 'path';

import vm from 'vm';

import nodeREPL from 'repl';

import * as CoffeeScript from './coffeescript.js';

import {
  merge,
  updateSyntaxError
} from './helpers.js';

import {
  Block,
  Assign,
  Value,
  Literal,
  Call,
  Code,
  Root
} from './nodes.js';

sawSIGINT = false;

transpile = false;

replDefaults = {
  prompt: 'coffee> ',
  historyFile: (function() {
    var historyPath;
    historyPath = process.env.XDG_CACHE_HOME || process.env.HOME;
    if (historyPath) {
      return path.join(historyPath, '.coffee_history');
    }
  })(),
  historyMaxInputSize: 10240,
  eval: function(input, context, filename, cb) {
    var ast, err, isAsync, js, ref, ref1, referencedVars, result, token, tokens;
    input = input.replace(/\uFF00/g, '\n');
    input = input.replace(/^\(([\s\S]*)\n\)$/m, '$1');
    input = input.replace(/^\s*try\s*{([\s\S]*)}\s*catch.*$/m, '$1');
    try {
      tokens = CoffeeScript.tokens(input);
      if (tokens.length >= 2 && tokens[0].generated && ((ref = tokens[0].comments) != null ? ref.length : void 0) !== 0 && `${tokens[0][1]}` === '' && tokens[1][0] === 'TERMINATOR') {
        tokens = tokens.slice(2);
      }
      if (tokens.length >= 1 && tokens[tokens.length - 1].generated && ((ref1 = tokens[tokens.length - 1].comments) != null ? ref1.length : void 0) !== 0 && `${tokens[tokens.length - 1][1]}` === '') {
        tokens.pop();
      }
      referencedVars = (function() {
        var i, len, results;
        results = [];
        for (i = 0, len = tokens.length; i < len; i++) {
          token = tokens[i];
          if (token[0] === 'IDENTIFIER') {
            results.push(token[1]);
          }
        }
        return results;
      })();
      ast = CoffeeScript.nodes(tokens).body;
      ast = new Block([new Assign(new Value(new Literal('__')), ast, '=')]);
      ast = new Code([], ast);
      isAsync = ast.isAsync;
      ast = new Root(new Block([new Call(ast)]));
      js = ast.compile({
        bare: true,
        locals: Object.keys(context),
        referencedVars,
        sharedScope: true
      });
      if (transpile) {
        js = transpile.transpile(js, transpile.options).code;
        js = js.replace(/^"use strict"|^'use strict'/, '');
      }
      result = runInContext(js, context, filename);
      if (isAsync) {
        result.then(function(resolvedResult) {
          if (!sawSIGINT) {
            return cb(null, resolvedResult);
          }
        });
        return sawSIGINT = false;
      } else {
        return cb(null, result);
      }
    } catch (error) {
      err = error;
      updateSyntaxError(err, input);
      return cb(err);
    }
  }
};

runInContext = function(js, context, filename) {
  if (context === global) {
    return vm.runInThisContext(js, filename);
  } else {
    return vm.runInContext(js, context, filename);
  }
};

addMultilineHandler = function(repl) {
  var inputStream, multiline, nodeLineListener, origPrompt, outputStream, ref;
  ({inputStream, outputStream} = repl);
  origPrompt = (ref = repl._prompt) != null ? ref : repl.prompt;
  multiline = {
    enabled: false,
    initialPrompt: origPrompt.replace(/^[^> ]*/, function(x) {
      return x.replace(/./g, '-');
    }),
    prompt: origPrompt.replace(/^[^> ]*>?/, function(x) {
      return x.replace(/./g, '.');
    }),
    buffer: ''
  };
  nodeLineListener = repl.listeners('line')[0];
  repl.removeListener('line', nodeLineListener);
  repl.on('line', function(cmd) {
    if (multiline.enabled) {
      multiline.buffer += `${cmd}\n`;
      repl.setPrompt(multiline.prompt);
      repl.prompt(true);
    } else {
      repl.setPrompt(origPrompt);
      nodeLineListener(cmd);
    }
  });
  return inputStream.on('keypress', function(char, key) {
    if (!(key && key.ctrl && !key.meta && !key.shift && key.name === 'v')) {
      return;
    }
    if (multiline.enabled) {
      if (!multiline.buffer.match(/\n/)) {
        multiline.enabled = !multiline.enabled;
        repl.setPrompt(origPrompt);
        repl.prompt(true);
        return;
      }
      if ((repl.line != null) && !repl.line.match(/^\s*$/)) {
        return;
      }
      multiline.enabled = !multiline.enabled;
      repl.line = '';
      repl.cursor = 0;
      repl.output.cursorTo(0);
      repl.output.clearLine(1);
      multiline.buffer = multiline.buffer.replace(/\n/g, '\uFF00');
      repl.emit('line', multiline.buffer);
      multiline.buffer = '';
    } else {
      multiline.enabled = !multiline.enabled;
      repl.setPrompt(multiline.initialPrompt);
      repl.prompt(true);
    }
  });
};

addHistory = function(repl, filename, maxSize) {
  var buffer, fd, lastLine, readFd, size, stat;
  lastLine = null;
  try {
    stat = fs.statSync(filename);
    size = Math.min(maxSize, stat.size);
    readFd = fs.openSync(filename, 'r');
    buffer = Buffer.alloc(size);
    fs.readSync(readFd, buffer, 0, size, stat.size - size);
    fs.closeSync(readFd);
    repl.history = buffer.toString().split('\n').reverse();
    if (stat.size > maxSize) {
      repl.history.pop();
    }
    if (repl.history[0] === '') {
      repl.history.shift();
    }
    repl.historyIndex = -1;
    lastLine = repl.history[0];
  } catch (error) {}
  fd = fs.openSync(filename, 'a');
  repl.addListener('line', function(code) {
    if (code && code.length && code !== '.history' && code !== '.exit' && lastLine !== code) {
      fs.writeSync(fd, `${code}\n`);
      return lastLine = code;
    }
  });
  repl.on('SIGINT', function() {
    return sawSIGINT = true;
  });
  repl.on('exit', function() {
    return fs.closeSync(fd);
  });
  return repl.commands[getCommandId(repl, 'history')] = {
    help: 'Show command history',
    action: function() {
      repl.outputStream.write(`${repl.history.slice(0).reverse().join('\n')}\n`);
      return repl.displayPrompt();
    }
  };
};

getCommandId = function(repl, commandName) {
  var commandsHaveLeadingDot;
  commandsHaveLeadingDot = repl.commands['.help'] != null;
  if (commandsHaveLeadingDot) {
    return `.${commandName}`;
  } else {
    return commandName;
  }
};

export var start = function(opts = {}) {
  var Module, build, major, minor, originalModuleLoad, repl;
  [major, minor, build] = process.versions.node.split('.').map(function(n) {
    return parseInt(n, 10);
  });
  if (major < 6) {
    console.warn("Node 6+ required for CoffeeScript REPL");
    process.exit(1);
  }
  CoffeeScript.register();
  process.argv = ['coffee'].concat(process.argv.slice(2));
  if (opts.transpile) {
    transpile = {};
    try {
      transpile.transpile = require('@babel/core').transform;
    } catch (error) {
      try {
        transpile.transpile = require('babel-core').transform;
      } catch (error) {
        console.error(`To use --transpile with an interactive REPL, @babel/core must be installed either in the current folder or globally:
  npm install --save-dev @babel/core
or
  npm install --global @babel/core
And you must save options to configure Babel in one of the places it looks to find its options.
See https://coffeescript.org/#transpilation`);
        process.exit(1);
      }
    }
    transpile.options = {
      filename: path.resolve(process.cwd(), '<repl>')
    };
    Module = require('module');
    originalModuleLoad = Module.prototype.load;
    Module.prototype.load = function(filename) {
      this.options = {
        transpile: transpile.options
      };
      return originalModuleLoad.call(this, filename);
    };
  }
  opts = merge(replDefaults, opts);
  repl = nodeREPL.start(opts);
  if (opts.prelude) {
    runInContext(opts.prelude, repl.context, 'prelude');
  }
  repl.on('exit', function() {
    if (!repl.closed) {
      return repl.outputStream.write('\n');
    }
  });
  addMultilineHandler(repl);
  if (opts.historyFile) {
    addHistory(repl, opts.historyFile, opts.historyMaxInputSize);
  }
  repl.commands[getCommandId(repl, 'load')].help = 'Load code from a file into this REPL session';
  return repl;
};
