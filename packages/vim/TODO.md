# Rip Vim — TODO

## Constraints

`syn keyword` outranks every match and region wherever it sits; among matches
and regions the one defined **last** wins. This is why the declaring words
(`class`, `def`, …) are matches and the value words sit at the end of the file.
`contains=TOP,{group}` means "all top-level groups **except** those listed" — a
contained group joins a region through `containedin=`.

`packages/vscode/test/unit/grammar-lockstep.test.js` pins two lines verbatim:
the `?!` operator alternation (`:116`) and `syn keyword ripKeyword try catch
finally` (`:132`).

## Keywords in property and key position

- [ ] `Array.from(x)`, `promise.catch(e)`, `Error.new()`, `obj.type` paint the
      keyword color instead of reading as a member, as do the keys in
      `{it: 1, when: 2, from: 3}`. Value words already decline the key position
      through the guard on their matches (`syntax/rip.vim:230-243`); control
      keywords are `syn keyword` (`syntax/rip.vim:57-68`), which admits no
      lookaround. Converting them to guarded matches means changing the pinned
      `try catch finally` line — **Steve's call**.

## Render blocks

The region and `#id` work (`syntax/rip.vim:253-255`); component references take
the PascalCase type color. Still flat:

- [ ] Tag names — `div`, `input`, `select`, `button` are unpainted.
- [ ] `.class` shorthand — `.product-filters` paints its hyphen as an operator.
      Also `.(expr)` dynamic classes.
- [ ] `$` data attributes — `$open: true` leaves the sigil bare. Only the
      tagged-template `\$\ze['"]` exists (`syntax/rip.vim:119`); scope a render
      rule to the region, since `$name` elsewhere is an ordinary identifier.
- [ ] Own-line boolean flags — `disabled` on its own line. vscode paints the
      `BOOLEAN_ATTRS` list from `src/dom.js` under a lockstep test; the same
      list would have to be carried here.
- [ ] `= expr` text nodes — the leading `=` reads as an operator.

## Schema blocks

- [ ] No field or type vocabulary. `name!` paints as `ripDammitCall`
      (`syntax/rip.vim:178`), which reads as an await-call rather than a
      required-field marker; `integer`, `datetime`, `date`, `text` are
      unpainted; `zip` takes the stdlib builtin color from the name collision.
      A `Name = schema` region, sibling to the render one, is the shape.
      Reference: `test/corpus/schema.rip`, `src/schema.js`.

## Type-level vocabulary

- [ ] `keyof`, `readonly`, `infer` and `satisfies` are unpainted. All four are
      valid — `type A = keyof T`, `type B = { readonly a: string }`,
      `Array<infer U>`, `x = y satisfies Foo` each compile — and vscode scopes
      them in its `type_expression` repository. `ripType`
      (`syntax/rip.vim:234`) carries only the primitive names.

## Pick operator

- [ ] `.{ }` and `?.{ }` have no rule (`src/lexer.js:1903-1919`,
      `test/rip/pick.rip`). Keys fall through to `ripObjKey` and
      `ripAssignment` — readable, but the construct is unmarked.

## Indent

- [ ] A one-line `try risky() finally cleanup()` opens a block. `s:increase`
      matches `^\s*try\>` and `s:inline` only guards the `then` spelling
      (`indent/rip.vim:21,33`); the clause words on the same line need to count
      too.

## vscode / highlight drift

- [ ] `keyword.control.rip` carries `use`, which is not a keyword — `use foo`
      compiles to `use(foo)`, and `test/rip/components.rip:3711` uses it as an
      ordinary variable.
- [ ] `keyword.operator.otherwise.rip` (`rip.tmLanguage.json:685`) scopes `!?`
      as one operator. The spelling is real — `a!?` compiles to
      `await a() != null` — but it is DAMMIT plus postfix existence, two
      tokens, so the name points at an operator that does not exist. The
      single-token spelling is `?!`, already scoped as `presence`.
- [ ] `=== INLINE JAVASCRIPT ===` (`rip.tmLanguage.json:83`) embeds `source.js`
      in backticks. A backtick in value position is a hard lexer error
      (`src/lexer.js:2030`); the one legitimate use is a template-literal type
      (`src/lexer.js:2017-2027`).
- [ ] `__DATA__` is unhandled in vscode and `packages/highlight`
      (`src/compile.js:178-193`).

## Verifying a change

Dump what Vim actually paints, then confirm the language's own reading:

```vim
" /tmp/dump.vim — one line per character: <line>,<col>,<char>,<group>
let s:o = []
for s:l in range(1, line('$'))
  for s:i in range(1, strlen(getline(s:l)))
    call add(s:o, s:l.','.s:i.','.getline(s:l)[s:i-1].','.synIDattr(synID(s:l,s:i,1),'name'))
  endfor
endfor
call writefile(s:o, $OUT) | qa!
```

```sh
OUT=/tmp/out.txt vim -es -u NONE -N --cmd 'set runtimepath^=PATH/TO/packages/vim' \
  -c 'syntax on' -c 'set filetype=rip' -S /tmp/dump.vim FILE.rip >/dev/null 2>&1

bun -e "import {compile} from './src/compile.js'; import {readFileSync} from 'fs';
  console.log(compile(readFileSync(process.argv[1],'utf8'),{runtimeDelivery:'none'}).code)" FILE.rip
```

Swap `synID` for `synIDtrans(synID(...))` to dump effective colors instead of
group names — that is the form to diff across a change, since a rename between
two groups that link to the same color is not a regression.
