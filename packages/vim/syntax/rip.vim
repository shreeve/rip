" Vim syntax file for Rip
" Language: Rip
" Maintainer: Steve Shreeve

if exists('b:current_syntax')
  finish
endif

" --- Comments ---------------------------------------------------------------

" A `###` block opens only at the START of a line (after its indent) and
" runs to the next `###`. Mid-line, a `#` is always a line comment — so is
" a fourth hash (`####…`).
syn match  ripComment      /#\%({\)\@!.*$/                       contains=ripTodo
syn region ripBlockComment  start=/^\s*###\%(#\)\@!/  end=/###/  contains=ripTodo
syn keyword ripTodo         TODO FIXME XXX NOTE HACK BUG WARN    contained

" --- __DATA__ ---------------------------------------------------------------

" Everything after a line that is exactly `__DATA__` is the program's DATA
" constant — raw text, never parsed.
syn region ripData          matchgroup=ripDataMarker start=/^__DATA__$/ end=/\%$/ contains=NONE

" --- Strings ----------------------------------------------------------------

" Single-quoted (no interpolation)
syn region ripStringSingle  start=/'/   skip=/\\'/  end=/'/      contains=ripEscape
syn region ripHeredocSingle start=/'''/             end=/'''/    contains=ripEscape

" Double-quoted (with interpolation)
syn region ripStringDouble  start=/"/   skip=/\\"/  end=/"/      contains=ripEscape,ripInterpolation
syn region ripHeredocDouble start=/"""/             end=/"""/    contains=ripEscape,ripInterpolation

" Escape sequences
syn match  ripEscape        /\\./                                contained

" String interpolation #{...} and ${...} with nested brace support
syn region ripInterpolation matchgroup=ripInterpDelim start=/#{/ start=/\${/ end=/}/ contained contains=TOP,ripInterpBraces
syn region ripInterpBraces  start=/{/ end=/}/ transparent contained contains=TOP,ripInterpBraces

" --- Template-Literal Types -------------------------------------------------

" A backtick opens a template-literal TYPE (`type Px = `${number}px``) — TS
" type text carried through verbatim. Strings are quote-based, so a backtick
" is the type spelling and nothing else.
syn region ripTypeTemplate  start=/`/  end=/`/  oneline

" --- Numbers ----------------------------------------------------------------

syn match  ripNumber        /\<0x[0-9a-fA-F]\%(_\?[0-9a-fA-F]\)*n\?\>/
syn match  ripNumber        /\<0o[0-7]\%(_\?[0-7]\)*n\?\>/
syn match  ripNumber        /\<0b[01]\%(_\?[01]\)*n\?\>/
syn match  ripNumber        /\<\d[0-9_]*\%(\.\d[0-9_]*\)\?\%([eE][+-]\?\d[0-9_]*\)\?n\?\>/

" --- Keywords ---------------------------------------------------------------

syn keyword ripKeyword      if else unless then switch when
syn keyword ripKeyword      for while until loop do
syn keyword ripKeyword      return break continue throw
syn keyword ripKeyword      try catch finally
syn keyword ripKeyword      yield await
syn keyword ripKeyword      import export from default
syn keyword ripKeyword      delete typeof instanceof new super
syn keyword ripKeyword      debugger own extends
syn keyword ripKeyword      in of by as
syn keyword ripKeyword      component render slot offer accept
syn keyword ripKeyword      and or not is isnt
syn keyword ripKeyword      it

" Declaring words are syn-MATCH, not syn-keyword: a keyword outranks every
" match at its own position, which would leave the definition rules below —
" all of which anchor on one of these words — unable to claim their name.
syn match  ripKeyword       /\<\%(class\|def\|enum\|interface\|type\|schema\)\>/

" PascalCase globals are syn-keyword: a keyword outranks every match wherever
" it sits, so these need no ordering, and no object key is spelled this way.
syn keyword ripBuiltin      Promise Array Object String Number Boolean
syn keyword ripBuiltin      Math Date RegExp Error TypeError RangeError
syn keyword ripBuiltin      JSON Map Set WeakMap WeakSet
syn keyword ripBuiltin      Symbol Proxy Reflect Buffer Bun
syn keyword ripBuiltin      URL URLSearchParams FormData
syn keyword ripBuiltin      Event CustomEvent EventSource
syn keyword ripBuiltin      HTMLElement Node NodeList Element
syn keyword ripBuiltin      DocumentFragment MutationObserver ResizeObserver
syn keyword ripBuiltin      IntersectionObserver

" --- Instance Variables -----------------------------------------------------

syn match  ripInstVar       /@[a-zA-Z_$][a-zA-Z0-9_$]*/

" --- Operators (shortest→longest for correct Vim priority) -----------------
"
" Vim rule: when multiple syn-match items start at the same position,
" the last-defined one wins. So define single-char first (lowest priority)
" and longest/most-specific last (highest priority).

" Single-char (lowest priority — overridden by everything below)
syn match  ripOperator      /[+\-*/%&|^~<>=!?]/

" Two-char
syn match  ripOperator      /\*\*\|\/\/\|%%\|++\|--/
syn match  ripOperator      /==\|!=\|<=\|>=\|&&\|||\|<<\|>>\|=\~\|\.\./

" Three-char
syn match  ripOperator      /===\|!==\|>>>\|\.\.\./

" Compound assignment (longest alternatives first within alternation)
syn match  ripOperator      />>>=\|\*\*=\|\/\/=\|%%=\|&&=\|||=\|??=\|<<=\|>>=\|+=\|-=\|\*=\|\/=\|%=\|&=\||=\|\^=/

" Special. `?!` is one token: bare Houdini/presence, or maybe dammit
" when call arguments follow.
syn match  ripOperator      /?!\|??\|?\./

" Method assignment (x .= trim()), map literal (*{a: 1}),
" existence assignment (a ?= 5)
syn match  ripOperator      /\.=\|\*{\@=\|?=/

" Tagged-template bridge: sh $"cmd" (the $ heads the template)
syn match  ripOperator      /\$\ze['"]/

" Symbol literals: :name / :domain.name / :kebab-name / :save! / :valid?
" → Symbol.for("…"). The !/? suffix matches only at a claim boundary,
" mirroring the lexer (:a!=b keeps != as an operator).
syn match  ripSymbol        /\%(\w\)\@<!:[a-zA-Z_$][a-zA-Z0-9_$]*\%([.-][a-zA-Z_$][a-zA-Z0-9_$]*\)*\%([!?]\%([[:space:],)\]};:]\|$\)\@=\)\=/

" Arrow functions
syn match  ripArrow         /[=-]>/

" Reactive (high priority). `~>` is the effect head; `!>` is the schema
" body's eager-derived field — siblings, so they read alike.
syn match  ripReactive      /<=>\|<\~\|:=\|\~=\|[~!]>\|=!/

" Prototype access: String::trim (`::` is prototype access only —
" `:` is the sole type-annotation operator. Type names after a `:`
" still highlight via ripType / ripPascalCase below.)
syn match  ripProtoOp       /::\%(=\)\@!/

" --- Word Arrays ------------------------------------------------------------

" %w[foo bar baz] — paired delimiters nest; symmetric ones repeat
syn region ripWordArray     matchgroup=ripWordDelim start=/%w\[/ end=/\]/
syn region ripWordArray     matchgroup=ripWordDelim start=/%w(/  end=/)/
syn region ripWordArray     matchgroup=ripWordDelim start=/%w{/  end=/}/
syn region ripWordArray     matchgroup=ripWordDelim start=/%w</  end=/>/
syn region ripWordArray     matchgroup=ripWordDelim start=/%w\z([^ \t[:alnum:]([{<]\)/ end=/\z1/

" --- Regular Expressions ----------------------------------------------------
"
" Defined AFTER the operator matches: at the same start column the
" last-defined item wins, so /// must outrank the // operator and
" /regex/ must outrank the / operator.

" A `/` opens a regex unless it divides, which mirrors the lexer's rule:
" division needs a value-ending token before the slash. Tight against one
" (`a/b`, `f()/2`, `arr[0]/2`) it always divides; spaced, a space AFTER the
" slash marks the division too (`a / b`), so `text.match /ab+c/` and
" `text =~ /foo/` stay regexes. `/=` is compound assignment, and `//`
" is floor division — the heregex above owns `///`.
syn region ripHeregex       start=/\/\/\//  end=/\/\/\/[gimsuy]*/  contains=ripInterpolation,ripComment,ripEscape
syn region ripRegex         matchgroup=ripRegexDelim start=+[A-Za-z0-9_$)\]}@]\@<!/\%([/*=]\|\s\)\@!+ skip=+\\/+ end=+/[gimsuy]*+ oneline contains=ripEscape

" --- Object Keys ------------------------------------------------------------

" Object keys: name: or name?: (but not :: or :=); compound chains
" (data-src:, www.amazon.com:) are one key
syn match  ripObjKey        /\<[a-zA-Z_$][a-zA-Z0-9_$]*\%([.-][a-zA-Z_$][a-zA-Z0-9_$]*\)*?\?:\%([=:]\)\@!/

" --- Function / Method Calls ------------------------------------------------

" Function calls: name(
syn match  ripFuncCall      /\<[a-zA-Z_$][a-zA-Z0-9_$]*\ze\s*(/

" Method calls: .name(
syn match  ripMethodCall    /\.\zs[a-zA-Z_$][a-zA-Z0-9_$]*\ze\s*(/

" Dammit calls: name! (await shorthand) — but a!=b is inequality, and
" a!== is strict inequality, so ! followed by = does not count
syn match  ripDammitCall    /\<[a-zA-Z_$][a-zA-Z0-9_$]*\ze!=\@!/

" --- Assignments ------------------------------------------------------------

" Variable assignment: name = (but not ==, =>, =~, =!)
syn match  ripAssignment    /\<[a-zA-Z_$][a-zA-Z0-9_$]*\ze\s*=\%([>=~!]\)\@!/

" The declaring forms `=!` (readonly), `:=` (state) and `~=` (computed)
" name a binding too, and each is excluded from the rule above. The name is
" the statement's FIRST word, so the match anchors there — reading backward
" from the operator instead would claim the type of an annotated declaration
" (`limit: number =! 100` names limit, not number).
syn match  ripReadonlyName  /^\s*\zs[a-zA-Z_$][a-zA-Z0-9_$]*\ze\s*\%(:[^=]*\)\?=!/
syn match  ripReactiveName  /^\s*\zs[a-zA-Z_$][a-zA-Z0-9_$]*\ze\s*\%(:[^=~]*\)\?\%(:=\|\~=\)/

" --- Function Definitions ---------------------------------------------------

" def name or def name!
syn match  ripFuncDef       /\<def\s\+[a-zA-Z_$][a-zA-Z0-9_$]*[!?]\?/ contains=ripFuncKeyword,ripFuncName
syn match  ripFuncKeyword   /\<def\>/                            contained
syn match  ripFuncName      /\%(\<def\s\+\)\@<=[a-zA-Z_$][a-zA-Z0-9_$]*[!?]\?/ contained

" name = (...) -> or name = ->  /  name: (...) -> or name: -> (method).
" The match stops at `\ze` so it covers the NAME alone — carrying the
" parameter list inside it painted the parameters as function names too.
syn match  ripFuncAssign    /[a-zA-Z_$][a-zA-Z0-9_$]*\ze\s*=\s*\%(([^)]*)\s*\)\?[=-]>/
syn match  ripFuncMethod    /[a-zA-Z_$][a-zA-Z0-9_$]*\ze\s*:\s*\%(([^)]*)\s*\)\?[=-]>/

" --- Class / Enum / Interface -----------------------------------------------

syn match  ripClassDef      /\<class\s\+\w\+\%(\s\+extends\s\+\w\+\%(\.\w\+\)*\)\?/ contains=ripKeyword,ripClassName,ripSuperName
syn match  ripEnumDef       /\<enum\s\+[A-Z]\w*/                 contains=ripKeyword,ripTypeName
syn match  ripInterfaceDef  /\<interface\s\+[A-Z]\w*\%(\s\+extends\s\+[A-Z]\w*\)\?/ contains=ripKeyword,ripTypeName,ripSuperName
syn match  ripTypeAliasDef  /\<type\s\+[A-Z]\w*/                 contains=ripKeyword,ripTypeName

syn match  ripClassName     /\%(\<class\s\+\)\@<=\w\+/          contained
syn match  ripSuperName     /\%(\<extends\s\+\)\@<=\w\+\%(\.\w\+\)*/ contained
syn match  ripTypeName      /\%(\<\%(enum\|interface\|type\)\s\+\)\@<=[A-Z]\w*/ contained

" PascalCase identifiers (type names)
syn match  ripPascalCase    /\<[A-Z]\w*/

" --- Value Words -----------------------------------------------------------
"
" Booleans, constants, primitive type names, `this`, and the globals spelled
" in lowercase. These sit last so they outrank the broad rules above — a
" call, an assignment target, a PascalCase name — which is the precedence a
" syn-keyword would give them for free. The trailing guard is what a keyword
" cannot express: a value word directly before a colon is an object KEY
" (`{on: 2}`, `{string: 1}`, `{kind: 3}`), so it declines the position and
" ripObjKey takes it.

syn match  ripBoolean       /\<\%(true\|false\|yes\|no\|on\|off\)\>\%(\s*?\?:\%([=:]\)\@!\)\@!/
syn match  ripConstant      /\<\%(null\|undefined\|NaN\|Infinity\)\>\%(\s*?\?:\%([=:]\)\@!\)\@!/
syn keyword ripThis         this

syn match  ripType          /\<\%(number\|string\|boolean\|void\|any\|never\|unknown\|object\|symbol\|bigint\)\>\%(\s*?\?:\%([=:]\)\@!\)\@!/

syn match  ripBuiltin       /\<\%(console\|process\|require\|module\|exports\)\>\%(\s*?\?:\%([=:]\)\@!\)\@!/
syn match  ripBuiltin       /\<\%(setTimeout\|setInterval\|clearTimeout\|clearInterval\)\>\%(\s*?\?:\%([=:]\)\@!\)\@!/
syn match  ripBuiltin       /\<\%(requestAnimationFrame\|cancelAnimationFrame\)\>\%(\s*?\?:\%([=:]\)\@!\)\@!/
syn match  ripBuiltin       /\<\%(document\|window\|globalThis\|navigator\|fetch\)\>\%(\s*?\?:\%([=:]\)\@!\)\@!/

" Rip stdlib (injected globals)
syn match  ripBuiltin       /\<\%(p\|pp\|pj\|pr\|abort\|assert\|exit\|kind\|noop\)\>\%(\s*?\?:\%([=:]\)\@!\)\@!/
syn match  ripBuiltin       /\<\%(raise\|rand\|sleep\|todo\|warn\|zip\|toMatchable\)\>\%(\s*?\?:\%([=:]\)\@!\)\@!/

" --- Render Blocks ----------------------------------------------------------

" Inside a render block a TIGHT `#word` is element-id syntax, not a comment:
" it merges into an unspaced preceding tag (`div#main`, `.card#x`) or mints
" an implicit div at a child position (`#main` → div#main). A spaced
" `# word` stays a comment. The block runs from `render` to the first
" non-blank line not indented deeper than `render` itself, which is the
" same span the scanner walks.
syn region ripRender        start=/^\z(\s*\)render\>/ end=/^\%(\z1\s\)\@!\s*\S/me=s-1 contains=TOP
syn match  ripRenderId      /[A-Za-z0-9_.-]\@<=#[A-Za-z_][A-Za-z0-9_-]*/  contained containedin=ripRender
syn match  ripRenderId      /\%(^\s*\)\@<=#[A-Za-z_][A-Za-z0-9_-]*/       contained containedin=ripRender

" --- Highlight Links --------------------------------------------------------

hi def link ripComment        Comment
hi def link ripData           String
hi def link ripDataMarker     PreProc
hi def link ripBlockComment   Comment
hi def link ripTodo           Todo

hi def link ripStringSingle   String
hi def link ripWordArray    String
hi def link ripSymbol       Constant
hi def link ripWordDelim    Delimiter
hi def link ripStringDouble   String
hi def link ripHeredocSingle  String
hi def link ripHeredocDouble  String
hi def link ripEscape         SpecialChar
hi def link ripInterpDelim    Special

hi def link ripTypeTemplate   Type

hi def link ripHeregex        String
hi def link ripRegex          String
hi def link ripRegexDelim     String

hi def link ripNumber         Number

hi def link ripKeyword        Keyword
hi def link ripBoolean        Boolean
hi def link ripConstant       Constant
hi def link ripThis           Keyword
hi def link ripType           Type
hi def link ripBuiltin        Special

hi def link ripInstVar        Identifier

hi def link ripOperator       Operator
hi def link ripArrow          Operator
hi def link ripReactive       Special
hi def link ripProtoOp        Operator

hi def link ripObjKey         Identifier
hi def link ripFuncCall       Function
hi def link ripMethodCall     Function
hi def link ripDammitCall     Function
hi def link ripAssignment     Identifier

hi def link ripFuncKeyword    Keyword
hi def link ripFuncName       Function
hi def link ripFuncAssign     Function
hi def link ripFuncMethod     Function
hi def link ripReadonlyName   Constant
hi def link ripReactiveName   Identifier
hi def link ripRenderId       Identifier
hi def link ripClassName      Type
hi def link ripSuperName      Type
hi def link ripTypeName       Type
hi def link ripPascalCase     Type

" --- Sync ---------------------------------------------------------------------
"
" Parse from the top of the file. Rip's multi-line constructs — heredocs,
" `###` blocks, heregexes, and a render block, which runs as deep as its
" indent — have no bounded look-back that establishes which one a line sits
" inside. A backward search over a fixed window puts the cursor's own line in
" whichever state that window happens to start in, so a line deep in a heredoc
" reads as code and a `#id` deep in a render block reads as a comment.

syn sync fromstart

let b:current_syntax = 'rip'
