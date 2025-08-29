# bumps-driver

A tiny runnable driver to exercise the Jison+CoffeeScript M (MUMPS) grammar.

## Usage

1) Install deps:
   npm install

2) Run on the included sample:
   npm start

3) Or parse a string directly:
   npm run parse

4) Or provide your own file:
   node driver.js path/to/file.m

The driver hands back a JSON AST on stdout. Toggle dialect knobs in `driver.js` under `parser.yy.options`.
