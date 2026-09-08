# Rip Vim — TODO

## Two layers

Neovim draws Rip in two passes, and which layer owns a gap decides whether it
is worth closing here.

| | source | coverage | available when |
|---|---|---|---|
| syntax | `packages/vim/syntax/rip.vim` | 96.6% | always |
| semantic tokens | `packages/vscode/src/server.js` over LSP | 20.9% | file compiles, `bun` + tsgo present |

Measured on `test/corpus/components.rip`: 2149 non-whitespace characters, 2075
painted by syntax; 99 semantic tokens covering 449 characters, all of them
identifiers (`class`, `property`, `method`, `parameter`, `variable`).

The semantic layer paints over the syntax layer where it has an opinion, and it
only has opinions about identifiers — never strings, comments, numbers,
keywords, operators, regexes, or heredocs. Plain Vim has no second layer at
all, and neither does a buffer that does not currently compile.

`ftdetect/rip.vim` is also what sets `filetype=rip`, which is what an LSP client
matches on. Without this package the language server never attaches.

## Constraints

`syn keyword` outranks every match and region wherever it sits; among matches
and regions the one defined **last** wins. Hence the declaring words
(`class`, `def`, …) are matches, and the value words sit at the end of the file
carrying an object-key guard.

`contains=TOP,{group}` means "all top-level groups **except** those listed" — a
contained group joins a region through `containedin=`.

`syn sync fromstart` (`syntax/rip.vim:326`) is load-bearing. Heredocs, `###`
blocks and render blocks run as long as their content, so a bounded look-back
puts a line deep inside one in whichever state the window happened to open in.

`packages/vscode/test/unit/grammar-lockstep.test.js` pins two lines verbatim:
the `?!`/`!?` operator alternation (`:116`) and `syn keyword ripKeyword try
catch finally` (`:132`).

---

## Only the syntax layer can do these

The semantic layer returns nothing for any of them, so they stay dark until the
syntax file paints them.

### Render blocks

The region and `#id` work (`syntax/rip.vim:255-257`). Component references
already come back from the LSP as `type`, so they are not in this list.

- [ ] **Tag names** — `div`, `input`, `select`, `button` are unpainted.
- [ ] **`.class` shorthand** — `.product-filters` paints its hyphen as an
      operator. Also `.(expr)` dynamic classes.
- [ ] **`$` data attributes** — `$open: true` leaves the sigil bare. Only the
      tagged-template `\$\ze['"]` exists (`syntax/rip.vim:121`); scope a render
      rule to the region, since `$name` elsewhere is an ordinary identifier.
- [ ] **Own-line boolean flags** — `disabled` on its own line. vscode paints the
      `BOOLEAN_ATTRS` list from `src/dom.js` under a lockstep test; the same
      list would have to be carried here.
- [ ] **`= expr` text nodes** — the leading `=` reads as an operator. The
      expression after it is already covered by the LSP.

### Type-level vocabulary

- [ ] **`keyof`, `readonly`, `infer`, `satisfies`** are unpainted. All four are
      valid — `type A = keyof T`, `Array<infer U>`, `x = y satisfies Foo` each
      compile. The type NAMES around them come back from the LSP as `type`;
      these keywords do not, because they are not identifiers. `ripType`
      (`syntax/rip.vim:236`) carries only the primitive names.

### Indent

- [ ] **A one-line `try … finally …` opens a block.** `s:increase` matches
      `^\s*try\>` and `s:inline` only guards the `then` spelling
      (`indent/rip.vim:21,33`); the clause words on the same line need to count
      too.

## The semantic layer already answers these

Real gaps in the syntax file, but on Neovim with the server running they are
already painted correctly. They still matter for plain Vim, for a buffer that
does not compile, and on a machine without `bun`/tsgo.

- [ ] **Keyword-named properties and keys.** `Array.from(x)`,
      `promise.catch(e)`, `obj.type` take the keyword color, as do the keys in
      `{it: 1, when: 2}`. Value words already decline the key position through
      the guard on their matches (`syntax/rip.vim:232-245`); control keywords
      are `syn keyword` (`syntax/rip.vim:57-68`), which admits no lookaround.
      Converting them to guarded matches means changing the pinned
      `try catch finally` line. *LSP returns `method` for `from`, `property` for
      `type`.*
- [ ] **Schema field names.** `name!` paints as `ripDammitCall`
      (`syntax/rip.vim:180`), which reads as an await-call rather than a
      required-field marker. *LSP returns `property [declaration]` for the field
      name.* The schema TYPE words are a separate gap the LSP does not cover:
      `integer`, `datetime`, `date`, `text` are unpainted, and `zip` takes the
      stdlib builtin color from the name collision.
- [ ] **Pick operator.** `.{ }` and `?.{ }` have no rule
      (`src/lexer.js:1903-1919`, `test/rip/pick.rip`); keys fall through to
      `ripObjKey` and `ripAssignment`. *LSP returns `property [declaration]` for
      each key.*

## Cross-package drift

- [ ] `packages/vscode/syntaxes/rip.tmLanguage.json`'s `keyword.control`
      alternation carries `use`, which is not a keyword — `use foo` compiles to
      `use(foo)`, and `test/rip/components.rip:3711` uses it as an ordinary
      variable.
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
      (`src/compile.js:178-193`). Vim covers it at `syntax/rip.vim:22`.

## Verifying a change

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
two groups that link to the same color is not a regression. Use one editor for
both sides of the diff: Vim and Neovim ship different default highlight links,
and mixing them reports every character in the file as changed.

For the semantic side, `vim.lsp.semantic_tokens.get_at_pos(0, line-1, col-1)`
inside Neovim reports what the server claims for a position.
