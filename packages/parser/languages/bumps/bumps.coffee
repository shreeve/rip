# bumps.coffee — SLR(1) grammar for M (MUMPS) targeting your Jison/Bison‑style parser (Rip parser)
#
# Notes:
# - Mirrors CoffeeScript’s `grammar.coffee` structure (small `o()` helper, `exports.bnf`, `exports.operators`, `exports.lex`).
# - Assumes a stateful lexer with CMD/EXPR modes so keywords aren’t reserved and command spacing is honored.
# - Keeps M’s uniform, left‑to‑right precedence by putting all binary ops in the same `%left` tier; unary handled with higher precedence.
# - Dot‑indent blocks are recorded per line via DOTS at line start; attach blocks in a post‑parse pass.
# - Pattern match (?), right operand is a PATTERN token for now (opaque). Swap in a sub‑grammar later if you want full validation.

# -------------------------- helper --------------------------
o = (pattern, action = '', opts = undefined) ->
  # pattern: space‑separated Jison symbols (string)
  # action: CoffeeScript (compiled to JS) semantic action body
  # opts:   {prec: 'TOKEN', merge: true, etc.}
  [pattern, action, opts]

# -------------------------- grammar --------------------------
exports.startSymbol = 'program'

exports.operators = [
  ['left', 'OR']
  ['left', 'AND']
  ['nonassoc', 'GT', 'LT', 'GE', 'LE', 'EQ', 'NE', 'CONTAINS', 'NCONTAINS', 'FOLLOWS', 'NFOLLOWS', 'SORTAFTER', 'NSORTAFTER']
  ['left', 'PMATCH']
  ['left', 'CONCAT']
  ['left', 'PLUS', 'MINUS']
  ['left', 'MUL', 'DIV', 'IDIV', 'MOD']
  ['right', 'EXP']
  ['right', 'UPLUS', 'UMINUS', 'NOT']
]

# Keep token list in sync with lexer below
exports.tokens = [
  'NEWLINE', 'DOTS', 'LABEL', 'CS'
  'LPAREN','RPAREN','COMMA','COLON','SEMI','CARET','AT','EQUAL'
  'STRING','NUMBER','NAME','PATTERN'
  'DOLFN','DOLSPECVAR','ZDOLFN','ZCOMMAND'
  # Commands
  'BREAK','CLOSE','DO','ELSE','FOR','GOTO','HALT','HANG','IF','JOB','KILL','LOCK','MERGE','NEW','OPEN','QUIT','READ','SET','USE','VIEW','WRITE','XECUTE'
  'TSTART','TCOMMIT','TROLLBACK','TRESTART'
  # Operators
  'OR','AND','NOT','CONCAT','GT','LT','GE','LE','EQ','NE','CONTAINS','NCONTAINS','FOLLOWS','NFOLLOWS','SORTAFTER','NSORTAFTER','PLUS','MINUS','MUL','DIV','IDIV','MOD','EXP','PMATCH'
]

exports.bnf =
  program: [
    o '', 'return yy.node("Program", {lines: []})'
    o 'lines', 'return yy.node("Program", {lines: $1})'
  ]

  lines: [
    o 'line', '$$ = [$1]'
    o 'lines NEWLINE line', '$1.push($3); $$ = $1'
    o 'lines NEWLINE', '$$ = $1'
  ]

  line: [
    o 'line_hdr opt_cmds opt_comment', '$$ = Object.assign($1, {cmds: $2, comment: $3 || null})'
    o 'line_hdr opt_comment', '$$ = Object.assign($1, {cmds: [], comment: $2 || null})'
  ]

  line_hdr: [
    o 'opt_dots opt_label', '$$ = yy.node("Line", {depth: $1, label: $2})'
    o 'opt_dots', '$$ = yy.node("Line", {depth: $1, label: null})'
  ]

  opt_dots: [
    o 'DOTS', '$$ = +yy.depth || +@$.yy?.depth || +@$.yytext || +yytext.length || 0'
    o '', '$$ = 0'
  ]

  opt_label: [
    o 'LABEL opt_formals', '$$ = yy.node("Label", {name: yytext, formals: $2})'
    o '', '$$ = null'
  ]

  opt_formals: [
    o 'LPAREN formals RPAREN', '$$ = $2'
    o '', '$$ = []'
  ]

  formals: [
    o 'NAME', '$$ = [ yy.node("Formal", {name: $1}) ]'
    o 'formals COMMA NAME', '$1.push(yy.node("Formal", {name: $3})); $$ = $1'
  ]

  opt_comment: [
    o 'COMMENT', '$$ = yytext'
    o '', '$$ = null'
  ]

  opt_cmds: [
    o 'cmds', '$$ = $1'
    o '', '$$ = []'
  ]

  cmds: [
    o 'cmd', '$$ = [$1]'
    o 'cmds CS cmd', '$1.push($3); $$ = $1'
  ]

  cmd: [
    o 'postcond cmd_word cmd_args', '$$ = yy.node("Cmd", {pc: $1, op: $2, args: $3})'
    o 'postcond cmd_word', '$$ = yy.node("Cmd", {pc: $1, op: $2, args: []})'
    o 'cmd_word cmd_args', '$$ = yy.node("Cmd", {pc: null, op: $1, args: $2})'
    o 'cmd_word', '$$ = yy.node("Cmd", {pc: null, op: $1, args: []})'
  ]

  postcond: [ o 'COLON expr', '$$ = $2' ]

  cmd_word: [
    o 'BREAK', '$$ = yytext'
    o 'CLOSE', '$$ = yytext'
    o 'DO', '$$ = yytext'
    o 'ELSE', '$$ = yytext'
    o 'FOR', '$$ = yytext'
    o 'GOTO', '$$ = yytext'
    o 'HALT', '$$ = yytext'
    o 'HANG', '$$ = yytext'
    o 'IF', '$$ = yytext'
    o 'JOB', '$$ = yytext'
    o 'KILL', '$$ = yytext'
    o 'LOCK', '$$ = yytext'
    o 'MERGE', '$$ = yytext'
    o 'NEW', '$$ = yytext'
    o 'OPEN', '$$ = yytext'
    o 'QUIT', '$$ = yytext'
    o 'READ', '$$ = yytext'
    o 'SET', '$$ = yytext'
    o 'USE', '$$ = yytext'
    o 'VIEW', '$$ = yytext'
    o 'WRITE', '$$ = yytext'
    o 'XECUTE', '$$ = yytext'
    o 'TSTART', '$$ = yytext'
    o 'TCOMMIT', '$$ = yytext'
    o 'TROLLBACK', '$$ = yytext'
    o 'TRESTART', '$$ = yytext'
    o 'ZCOMMAND', '$$ = yytext'
  ]

  # ---- argument patterns ----
  cmd_args: [
    o 'set_list', '$$ = $1'
    o 'kill_list', '$$ = $1'
    o 'new_list', '$$ = $1'
    o 'do_list', '$$ = $1'
    o 'write_list', '$$ = $1'
    o 'read_list', '$$ = $1'
    o 'exprlist', '$$ = $1'
    o '', '$$ = []'
  ]

  set_list: [ o 'SET CS set_items', '$$ = yy.node("ArgsSET", {items: $3})' ]
  set_items: [
    o 'set_item', '$$ = [$1]'
    o 'set_items COMMA set_item', '$1.push($3); $$ = $1'
  ]
  set_item: [ o 'lvalue EQUAL expr', '$$ = yy.node("Set", {lhs: $1, rhs: $3})' ]

  kill_list: [
    o 'KILL', '$$ = yy.node("ArgsKILL", {items: []})'
    o 'KILL CS kill_items', '$$ = yy.node("ArgsKILL", {items: $3})'
  ]
  kill_items: [
    o 'lvalue', '$$ = [$1]'
    o 'kill_items COMMA lvalue', '$1.push($3); $$ = $1'
  ]

  new_list: [ o 'NEW CS name_list', '$$ = yy.node("ArgsNEW", {names: $3})' ]
  name_list: [
    o 'NAME', '$$ = [$1]'
    o 'name_list COMMA NAME', '$1.push($3); $$ = $1'
  ]

  do_list: [
    o 'DO', '$$ = yy.node("ArgsDO", {targets: []})'
    o 'DO CS entryref_list', '$$ = yy.node("ArgsDO", {targets: $3})'
  ]
  entryref_list: [
    o 'entryref', '$$ = [$1]'
    o 'entryref_list COMMA entryref', '$1.push($3); $$ = $1'
  ]
  entryref: [
    o 'NAME', '$$ = yy.node("EntryRef", {label: $1, routine: null, offset: null, args: []})'
    o 'NAME CARET NAME', '$$ = yy.node("EntryRef", {label: $1, routine: $3, offset: null, args: []})'
    o 'NAME PLUS NUMBER CARET NAME', '$$ = yy.node("EntryRef", {label: $1, routine: $5, offset: +$3, args: []})'
    o 'CARET NAME', '$$ = yy.node("EntryRef", {label: null, routine: $2, offset: null, args: []})'
  ]

  write_list: [ o 'WRITE CS witems', '$$ = yy.node("ArgsWRITE", {items: $3})' ]
  witems: [
    o 'expr', '$$ = [$1]'
    o 'witems COMMA expr', '$1.push($3); $$ = $1'
  ]

  read_list: [ o 'READ CS ritems', '$$ = yy.node("ArgsREAD", {items: $3})' ]
  ritems: [
    o 'ritem', '$$ = [$1]'
    o 'ritems COMMA ritem', '$1.push($3); $$ = $1'
  ]
  ritem: [
    o 'lvalue', '$$ = yy.node("ReadItem", {lhs: $1, timeout: null})'
    o 'lvalue COLON expr', '$$ = yy.node("ReadItem", {lhs: $1, timeout: $3})'
  ]

  # ---- expressions ----
  expr: [
    o 'primary', '$$ = $1'
    o 'expr PLUS expr', '$$ = yy.node("BinOp", {op: "+", lhs: $1, rhs: $3})'
    o 'expr MINUS expr', '$$ = yy.node("BinOp", {op: "-", lhs: $1, rhs: $3})'
    o 'expr MUL expr', '$$ = yy.node("BinOp", {op: "*", lhs: $1, rhs: $3})'
    o 'expr EXP expr', '$$ = yy.node("BinOp", {op: "**", lhs: $1, rhs: $3})'
    o 'expr DIV expr', '$$ = yy.node("BinOp", {op: "/", lhs: $1, rhs: $3})'
    o 'expr IDIV expr', '$$ = yy.node("BinOp", {op: "\", lhs: $1, rhs: $3})'
    o 'expr MOD expr', '$$ = yy.node("BinOp", {op: "#", lhs: $1, rhs: $3})'
    o 'expr AND expr', '$$ = yy.node("BinOp", {op: "&", lhs: $1, rhs: $3})'
    o 'expr OR expr', '$$ = yy.node("BinOp", {op: "!", lhs: $1, rhs: $3})'
    o 'expr CONCAT expr', '$$ = yy.node("BinOp", {op: "_", lhs: $1, rhs: $3})'
    o 'expr GT expr', '$$ = yy.node("Rel", {op: "GT", lhs: $1, rhs: $3})'
    o 'expr LT expr', '$$ = yy.node("Rel", {op: "LT", lhs: $1, rhs: $3})'
    o 'expr GE expr', '$$ = yy.node("Rel", {op: "GE", lhs: $1, rhs: $3})'
    o 'expr LE expr', '$$ = yy.node("Rel", {op: "LE", lhs: $1, rhs: $3})'
    o 'expr EQ expr', '$$ = yy.node("Rel", {op: "EQ", lhs: $1, rhs: $3})'
    o 'expr NE expr', '$$ = yy.node("Rel", {op: "NE", lhs: $1, rhs: $3})'
    o 'expr CONTAINS expr', '$$ = yy.node("Rel", {op: "CONTAINS", lhs: $1, rhs: $3})'
    o 'expr NCONTAINS expr', '$$ = yy.node("Rel", {op: "NCONTAINS", lhs: $1, rhs: $3})'
    o 'expr FOLLOWS expr', '$$ = yy.node("Rel", {op: "FOLLOWS", lhs: $1, rhs: $3})'
    o 'expr NFOLLOWS expr', '$$ = yy.node("Rel", {op: "NFOLLOWS", lhs: $1, rhs: $3})'
    o 'expr SORTAFTER expr', '$$ = yy.node("Rel", {op: "SORTAFTER", lhs: $1, rhs: $3})'
    o 'expr NSORTAFTER expr', '$$ = yy.node("Rel", {op: "NSORTAFTER", lhs: $1, rhs: $3})'
    o 'expr PMATCH PATTERN', '$$ = yy.node("PatternMatch", {lhs: $1, pat: yytext})'
    o 'NOT expr %prec NOT', '$$ = yy.node("UnOp", {op: "NOT", expr: $2})'
    o 'PLUS expr %prec UPLUS', '$$ = yy.node("UnOp", {op: "+", expr: $2})'
    o 'MINUS expr %prec UMINUS', '$$ = yy.node("UnOp", {op: "-", expr: $2})'
  ]

  primary: [
    o 'NUMBER', '$$ = yy.node("Number", {value: +yytext})'
    o 'STRING', '$$ = yy.node("String", {value: yytext})'
    o 'varref', '$$ = $1'
    o 'LPAREN expr RPAREN', '$$ = $2'
    o 'dolfn_call', '$$ = $1'
  ]

  varref: [
    o 'opt_global NAME', '$$ = yy.node("Var", {global: $1, name: $2, subs: []})'
    o 'opt_global NAME LPAREN exprlist RPAREN', '$$ = yy.node("Var", {global: $1, name: $2, subs: $4})'
    o 'AT NAME', '$$ = yy.node("Indirect", {kind: "name", target: $2})'
    o 'AT LPAREN expr RPAREN', '$$ = yy.node("Indirect", {kind: "expr", target: $3})'
  ]

  opt_global: [ o 'CARET', '$$ = true', o '', '$$ = false' ]

  exprlist: [
    o 'expr', '$$ = [$1]'
    o 'exprlist COMMA expr', '$1.push($3); $$ = $1'
  ]

  dolfn_call: [
    o 'DOLFN LPAREN exprlist RPAREN', '$$ = yy.node("DollarFn", {name: $1, args: $3})'
    o 'DOLSPECVAR', '$$ = yy.node("DollarVar", {name: $1})'
    o 'ZDOLFN LPAREN exprlist RPAREN', '$$ = yy.node("DollarFn", {name: $1, zext: true, args: $3})'
  ]

  lvalue: [ o 'varref', '$$ = $1' ]

# -------------------------- node factory --------------------------
# You already use helper factories in Rip; this adds a default if yy.node isn’t provided.
if !exports.moduleInclude?
  exports.moduleInclude = ->
    @node ?= (type, props) -> Object.assign {type}, (props or {})

# -------------------------- lexer --------------------------
# Jison lex spec (CoffeeScript object form). Two primary modes: INITIAL (line start), CMD, EXPR.
exports.lex =
  macros: {}
  startConditions:
    INITIAL: 0
    CMD: 1
    EXPR: 1
  rules: [
    # Newlines
    ['\r?\n+', 'return "NEWLINE";']

    # INITIAL (line start)
    ['<INITIAL>\.+', 'yy.depth = yytext.length; return "DOTS";']
    ['<INITIAL>[ \t]+', '/* ignore */']
    ['<INITIAL>;[^\n]*', 'return "COMMENT";']
    ['<INITIAL>[A-Za-z%][A-Za-z0-9]*', 'this.begin("CMD"); return "LABEL";']

    # CMD: commands and command‑space switch to EXPR
    ['<CMD>(?:break|b)\b', 'return "BREAK";']
    ['<CMD>(?:close|c)\b', 'return "CLOSE";']
    ['<CMD>(?:do|d)\b', 'return "DO";']
    ['<CMD>(?:else|e)\b', 'return "ELSE";']
    ['<CMD>(?:for|f)\b', 'return "FOR";']
    ['<CMD>(?:goto|g)\b', 'return "GOTO";']
    ['<CMD>(?:halt|h)\b', 'return "HALT";']
    ['<CMD>hang\b', 'return "HANG";']
    ['<CMD>(?:if|i)\b', 'return "IF";']
    ['<CMD>(?:job|j)\b', 'return "JOB";']
    ['<CMD>(?:kill|k)\b', 'return "KILL";']
    ['<CMD>(?:lock|l)\b', 'return "LOCK";']
    ['<CMD>(?:merge|m)\b', 'return "MERGE";']
    ['<CMD>(?:new|n)\b', 'return "NEW";']
    ['<CMD>(?:open|o)\b', 'return "OPEN";']
    ['<CMD>(?:quit|q)\b', 'return "QUIT";']
    ['<CMD>(?:read|r)\b', 'return "READ";']
    ['<CMD>(?:set|s)\b', 'return "SET";']
    ['<CMD>(?:use|u)\b', 'return "USE";']
    ['<CMD>(?:view|v)\b', 'return "VIEW";']
    ['<CMD>(?:write|w)\b', 'return "WRITE";']
    ['<CMD>(?:xecute|x)\b', 'return "XECUTE";']
    ['<CMD>tstart\b', 'return "TSTART";']
    ['<CMD>tcommit\b', 'return "TCOMMIT";']
    ['<CMD>trollback\b', 'return "TROLLBACK";']
    ['<CMD>trestart\b', 'return "TRESTART";']
    ['<CMD>z[a-z][a-z0-9]*\b', 'yytext = yytext.toUpperCase(); return "ZCOMMAND";']

    ['<CMD>[ ]+', 'this.begin("EXPR"); return "CS";']
    ['<CMD>;[^\n]*', 'return "COMMENT";']
    ['<CMD>\r?\n+', 'this.begin("INITIAL"); return "NEWLINE";']

    # EXPR → COMMAND boundary and whitespace/comments
    ['<EXPR>;[^\n]*', 'return "COMMENT";']
    ['<EXPR>[ ]+', 'this.begin("CMD"); return "CS";']
    ['<EXPR>\r?\n+', 'this.begin("INITIAL"); return "NEWLINE";']

    # punctuation
    ['<EXPR>\(', 'return "LPAREN";']
    ['<EXPR>\)', 'return "RPAREN";']
    ['<EXPR>,', 'return "COMMA";']
    ['<EXPR>:', 'return "COLON";']
    ['<EXPR>\^', 'return "CARET";']
    ['<EXPR>@', 'return "AT";']

    # operators
    ['<EXPR>\+','return "PLUS";']
    ['<EXPR>-','return "MINUS";']
    ['<EXPR>\*\*','return "EXP";']
    ['<EXPR>\*','return "MUL";']
    ['<EXPR>\\','return "IDIV";']
    ['<EXPR>#','return "MOD";']
    ['<EXPR>/','return "DIV";']
    ['<EXPR>&','return "AND";']
    ['<EXPR>!','return "OR";']
    ['<EXPR>_','return "CONCAT";']
    ['<EXPR>>=','return "GE";']
    ['<EXPR><=','return "LE";']
    ['<EXPR>>','return "GT";']
    ['<EXPR><','return "LT";']
    ["<EXPR>'=", 'return "NE";']
    ['<EXPR>=', 'return "EQ";']
    ["<EXPR>'\\[", 'return "NCONTAINS";']
    ['<EXPR>\\[', 'return "CONTAINS";']
    ["<EXPR>\\]'", 'return "NFOLLOWS";']
    ['<EXPR>\\]', 'return "FOLLOWS";']
    ["<EXPR>\\]\\]'", 'return "NSORTAFTER";']
    ['<EXPR>\\]\\]', 'return "SORTAFTER";']
    ["<EXPR>'", 'return "NOT";']
    ['<EXPR>\?[^\s,\)]+', 'yytext = yytext.slice(1); return "PATTERN";']
    ['<EXPR>\?', 'return "PMATCH";']

    # atoms
    ['<EXPR>\d+(?:\.\d+)?', 'return "NUMBER";']
    ['<EXPR>\"(?:\"\"|[^\"])*\"', 'return "STRING";']
    ['<EXPR>\$z[a-z][a-z0-9]*\b', 'yytext = yytext.slice(2).toUpperCase(); return "ZDOLFN";']
    ['<EXPR>\$[a-z][a-z0-9]*\b', 'yytext = yytext.slice(1).toUpperCase(); return "DOLFN";']
    ['<EXPR>[A-Za-z%][A-Za-z0-9]*', 'return "NAME";']
  ]
