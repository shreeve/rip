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
  'LPAREN','RPAREN','COMMA','COLON','SEMI','CARET','AT'
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
    o 'LABEL opt_formals', '$$ = yy.node("Label", {name: $1, formals: $2})'
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
    # GOTO
    o 'postcond opt_cs GOTO goto_list', '$$ = yy.node("Cmd", {pc: $1, op: "GOTO", args: $4})'
    o 'GOTO goto_list',          '$$ = yy.node("Cmd", {pc: null, op: "GOTO", args: $2})'
    # Command-specific forms
    o 'postcond opt_cs SET set_list',   '$$ = yy.node("Cmd", {pc: $1, op: "SET",   args: $4})'
    o 'SET set_list',            '$$ = yy.node("Cmd", {pc: null, op: "SET",  args: $2})'
    o 'postcond opt_cs WRITE write_list','$$ = yy.node("Cmd", {pc: $1, op: "WRITE", args: $4})'
    o 'WRITE write_list',        '$$ = yy.node("Cmd", {pc: null, op: "WRITE",args: $2})'
    o 'postcond opt_cs READ read_list', '$$ = yy.node("Cmd", {pc: $1, op: "READ",  args: $4})'
    o 'READ read_list',          '$$ = yy.node("Cmd", {pc: null, op: "READ", args: $2})'
    o 'postcond opt_cs NEW new_list',   '$$ = yy.node("Cmd", {pc: $1, op: "NEW",   args: $4})'
    o 'NEW new_list',            '$$ = yy.node("Cmd", {pc: null, op: "NEW",  args: $2})'
    o 'postcond opt_cs KILL kill_list', '$$ = yy.node("Cmd", {pc: $1, op: "KILL",  args: $4})'
    o 'KILL kill_list',          '$$ = yy.node("Cmd", {pc: null, op: "KILL", args: $2})'
    o 'postcond opt_cs DO do_list',     '$$ = yy.node("Cmd", {pc: $1, op: "DO",    args: $4})'
    o 'DO do_list',              '$$ = yy.node("Cmd", {pc: null, op: "DO",   args: $2})'

    # IF/ELSE (blocks can be assembled later by depth from Line.depth)
    o 'postcond opt_cs IF CS expr',     '$$ = yy.node("If", {pc: $1, cond: $5})'
    o 'IF CS expr',              '$$ = yy.node("If", {pc: null, cond: $3})'
    o 'postcond opt_cs ELSE',           '$$ = yy.node("Else", {pc: $1})'
    o 'ELSE',                    '$$ = yy.node("Else", {pc: null})'

    # LOCK / MERGE with postconditions
    o 'postcond opt_cs LOCK lock_list', '$$ = yy.node("Cmd", {pc: $1, op: "LOCK",  args: $4})'
    o 'LOCK lock_list',          '$$ = yy.node("Cmd", {pc: null, op: "LOCK", args: $2})'
    o 'postcond opt_cs MERGE merge_list','$$ = yy.node("Cmd", {pc: $1, op: "MERGE", args: $4})'
    o 'MERGE merge_list',        '$$ = yy.node("Cmd", {pc: null, op: "MERGE",args: $2})'

    # Device-style commands: allow simple exprlist OR colon params per device
    o 'postcond opt_cs OPEN CS exprlist', '$$ = yy.node("Cmd", {pc: $1, op: "OPEN", args: $5})'
    o 'OPEN CS exprlist',                 '$$ = yy.node("Cmd", {pc: null, op: "OPEN", args: $3})'
    o 'postcond opt_cs OPEN dev_args',    '$$ = yy.node("Cmd", {pc: $1, op: "OPEN", args: $4})'
    o 'OPEN dev_args',                    '$$ = yy.node("Cmd", {pc: null, op: "OPEN", args: $2})'

    o 'postcond opt_cs USE CS exprlist',  '$$ = yy.node("Cmd", {pc: $1, op: "USE",  args: $5})'
    o 'USE CS exprlist',                  '$$ = yy.node("Cmd", {pc: null, op: "USE",  args: $3})'
    o 'postcond opt_cs USE dev_args',     '$$ = yy.node("Cmd", {pc: $1, op: "USE",  args: $4})'
    o 'USE dev_args',                     '$$ = yy.node("Cmd", {pc: null, op: "USE",  args: $2})'

    o 'postcond opt_cs VIEW CS exprlist', '$$ = yy.node("Cmd", {pc: $1, op: "VIEW", args: $5})'
    o 'VIEW CS exprlist',                 '$$ = yy.node("Cmd", {pc: null, op: "VIEW", args: $3})'
    o 'postcond opt_cs VIEW dev_args',    '$$ = yy.node("Cmd", {pc: $1, op: "VIEW", args: $4})'
    o 'VIEW dev_args',                    '$$ = yy.node("Cmd", {pc: null, op: "VIEW", args: $2})'

    o 'postcond opt_cs CLOSE CS exprlist','$$ = yy.node("Cmd", {pc: $1, op: "CLOSE",args: $5})'
    o 'CLOSE CS exprlist',                '$$ = yy.node("Cmd", {pc: null, op: "CLOSE",args: $3})'
    o 'postcond opt_cs CLOSE dev_args',   '$$ = yy.node("Cmd", {pc: $1, op: "CLOSE",args: $4})'
    o 'CLOSE dev_args',                   '$$ = yy.node("Cmd", {pc: null, op: "CLOSE",args: $2})'

    # FOR header (inline form)
    o 'postcond opt_cs FOR for_header', '$$ = yy.node("For", {pc: $1, specs: $4})'
    o 'FOR for_header',                 '$$ = yy.node("For", {pc: null, specs: $2})'

    # JOB variants: entryrefs with optional colon params after each target
    o 'postcond opt_cs JOB job_list', '$$ = yy.node("Cmd", {pc: $1, op: "JOB", args: $4})'
    o 'JOB job_list',                 '$$ = yy.node("Cmd", {pc: null, op: "JOB", args: $2})'

    # Generic fallback: other commands with expression arglists
    o 'postcond opt_cs cmd_word CS exprlist', '$$ = yy.node("Cmd", {pc: $1, op: $3, args: $5})'
    o 'cmd_word CS exprlist',          '$$ = yy.node("Cmd", {pc: null, op: $1, args: $3})'
    o 'postcond opt_cs cmd_word',             '$$ = yy.node("Cmd", {pc: $1, op: $3, args: []})'
    o 'cmd_word',                      '$$ = yy.node("Cmd", {pc: null, op: $1, args: []})'
  ]

  postcond: [ o 'COLON expr', '$$ = $2' ]
  opt_cs: [ o 'CS', '$$ = null', o '', '$$ = null' ]

  # Device args: requires at least one colon after the first expr to disambiguate from generic exprlist
  dev_args: [
    o 'CS expr COLON expr dev_params more_devs', '$$ = yy.node("ArgsDEVICE", {specs: [ {device: $2, params: [$4].concat($5)} ].concat($6) })'
  ]
  dev_params: [
    o 'COLON expr dev_params', '$$ = [$2].concat($3)'
    o '', '$$ = []'
  ]
  more_devs: [
    o 'COMMA expr opt_params more_devs', '$$ = [ {device: $2, params: $3} ].concat($4)'
    o '', '$$ = []'
  ]
  opt_params: [
    o 'COLON expr dev_params', '$$ = [$2].concat($3)'
    o '', '$$ = []'
  ]

  for_header: [
    o 'CS for_specs', '$$ = $2'
  ]

  for_specs: [
    o 'for_spec', '$$ = [$1]'
    o 'for_specs COMMA for_spec', '$1.push($3); $$ = $1'
  ]

  for_spec: [
    o 'NAME EQ expr COLON expr COLON expr', '$$ = {name: $1, from: $3, step: $5, to: $7}'
    o 'NAME EQ expr COLON expr', '$$ = {name: $1, from: $3, step: yy.node("Number", {value: 1}), to: $5}'
  ]

  cmd_word: [
    o 'BREAK', '$$ = yytext'
    o 'CLOSE', '$$ = yytext'
    o 'DO', '$$ = yytext'
    o 'ELSE', '$$ = yytext'
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
  # After a command token, arguments start in EXPR mode and are preceded by CS.
  # Each list below omits the command token; it only consumes the CS and the args.
  cmd_args: [
    o 'set_list', '$$ = $1'
    o 'kill_list', '$$ = $1'
    o 'new_list', '$$ = $1'
    o 'do_list', '$$ = $1'
    o 'write_list', '$$ = $1'
    o 'read_list', '$$ = $1'
    o 'CS exprlist', '$$ = $2'
  ]

  set_list: [ o 'CS set_items', '$$ = yy.node("ArgsSET", {items: $2})' ]
  set_items: [
    o 'set_item', '$$ = [$1]'
    o 'set_items COMMA set_item', '$1.push($3); $$ = $1'
  ]
  set_item: [
    o 'NAME LPAREN exprlist RPAREN EQ expr', '$$ = yy.node("Set", {lhs: yy.node("Var", {global: false, name: $1, subs: $3}), rhs: $6})'
    o 'lvalue EQ expr', '$$ = yy.node("Set", {lhs: $1, rhs: $3})'
  ]

  kill_list: [
    o 'CS kill_items', '$$ = yy.node("ArgsKILL", {items: $2})'
    o 'CS LPAREN kill_items RPAREN', '$$ = yy.node("ArgsKILL", {items: $3})'
  ]
  kill_items: [
    o 'lvalue', '$$ = [$1]'
    o 'kill_items COMMA lvalue', '$1.push($3); $$ = $1'
  ]

  new_list: [
    o 'CS new_items', '$$ = yy.node("ArgsNEW", {names: $2})'
    o 'CS LPAREN new_items RPAREN', '$$ = yy.node("ArgsNEW", {names: $3})'
  ]
  new_items: [
    o 'new_item', '$$ = [$1]'
    o 'new_items COMMA new_item', '$1.push($3); $$ = $1'
  ]
  new_item: [
    o 'NAME', '$$ = $1'
    o 'AT NAME', '$$ = yy.node("Indirect", {kind: "name", target: $2})'
    o 'AT LPAREN expr RPAREN', '$$ = yy.node("Indirect", {kind: "expr", target: $3})'
  ]

  do_list: [ o 'CS entryref_list', '$$ = yy.node("ArgsDO", {targets: $2})' ]
  entryref_list: [
    o 'entryref', '$$ = [$1]'
    o 'entryref_list COMMA entryref', '$1.push($3); $$ = $1'
  ]
  entryref: [
    o 'NAME opt_entryargs', '$$ = yy.node("EntryRef", {label: $1, routine: null, offset: null, args: $2})'
    o 'NAME CARET NAME opt_entryargs', '$$ = yy.node("EntryRef", {label: $1, routine: $3, offset: null, args: $4})'
    o 'NAME PLUS NUMBER CARET NAME opt_entryargs', '$$ = yy.node("EntryRef", {label: $1, routine: $5, offset: +$3, args: $6})'
    o 'NAME MINUS NUMBER CARET NAME opt_entryargs', '$$ = yy.node("EntryRef", {label: $1, routine: $5, offset: -$3, args: $6})'
    o 'CARET NAME opt_entryargs', '$$ = yy.node("EntryRef", {label: null, routine: $2, offset: null, args: $3})'
  ]
  opt_entryargs: [
    o 'LPAREN exprlist RPAREN', '$$ = $2'
    o '', '$$ = []'
  ]

  # JOB args
  job_list: [ o 'CS job_items', '$$ = $2' ]
  job_items: [
    o 'job_item', '$$ = [$1]'
    o 'job_items COMMA job_item', '$1.push($3); $$ = $1'
  ]
  job_item: [ o 'entryref opt_params', '$$ = yy.node("JobTarget", {target: $1, params: $2})' ]

  write_list: [ o 'CS witems', '$$ = yy.node("ArgsWRITE", {items: $2})' ]
  witems: [
    o 'expr', '$$ = [$1]'
    o 'witems COMMA expr', '$1.push($3); $$ = $1'
  ]

  read_list: [ o 'CS ritems', '$$ = yy.node("ArgsREAD", {items: $2})' ]
  ritems: [
    o 'ritem', '$$ = [$1]'
    o 'ritems COMMA ritem', '$1.push($3); $$ = $1'
  ]
  ritem: [
    o 'lvalue', '$$ = yy.node("ReadItem", {lhs: $1, timeout: null})'
    o 'lvalue COLON expr', '$$ = yy.node("ReadItem", {lhs: $1, timeout: $3})'
  ]

  # LOCK
  lock_list: [ o 'CS lock_items', '$$ = $2' ]
  lock_items: [
    o 'lock_item', '$$ = [$1]'
    o 'lock_items COMMA lock_item', '$1.push($3); $$ = $1'
  ]
  lock_item: [
    o 'lvalue', '$$ = yy.node("LockItem", {res: $1, timeout: null})'
    o 'lvalue COLON expr', '$$ = yy.node("LockItem", {res: $1, timeout: $3})'
  ]

  # MERGE
  merge_list: [ o 'CS merge_items', '$$ = $2' ]
  merge_items: [
    o 'merge_item', '$$ = [$1]'
    o 'merge_items COMMA merge_item', '$1.push($3); $$ = $1'
  ]
  merge_item: [ o 'lvalue EQ lvalue', '$$ = yy.node("Merge", {target: $1, source: $3})' ]

  # GOTO targets reuse entryref
  goto_list: [ o 'CS entryref_list', '$$ = $2' ]

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
    o 'expr PMATCH PATTERN', '$$ = yy.node("PatternMatch", {lhs: $1, pat: (yy.parsePattern ? yy.parsePattern($3) : $3)})'
    o 'NOT expr %prec NOT', '$$ = yy.node("UnOp", {op: "NOT", expr: $2})'
    o 'PLUS expr %prec UPLUS', '$$ = yy.node("UnOp", {op: "+", expr: $2})'
    o 'MINUS expr %prec UMINUS', '$$ = yy.node("UnOp", {op: "-", expr: $2})'
  ]

  primary: [
    o 'NUMBER', '$$ = yy.node("Number", {value: +yytext})'
    o 'STRING', '$$ = yy.node("String", {value: yytext})'
    o 'NAME', '$$ = yy.node("Var", {global: false, name: $1, subs: []})'
    o 'varref', '$$ = $1'
    o 'LPAREN expr RPAREN', '$$ = $2'
    o 'dolfn_call', '$$ = $1'
  ]

  varref: [
    o 'opt_global NAME opt_subs', '$$ = yy.node("Var", {global: $1, name: $2, subs: $3})'
    o 'AT NAME', '$$ = yy.node("Indirect", {kind: "name", target: $2})'
    o 'AT LPAREN expr RPAREN', '$$ = yy.node("Indirect", {kind: "expr", target: $3})'
  ]
  opt_subs: [
    o 'LPAREN exprlist RPAREN', '$$ = $2'
    o '', '$$ = []'
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

  lvalue: [
    o 'NAME LPAREN exprlist RPAREN', '$$ = yy.node("Var", {global: false, name: $1, subs: $3})'
    o 'varref', '$$ = $1'
    o 'NAME', '$$ = yy.node("Var", {global: false, name: $1, subs: []})'
  ]

# -------------------------- node factory --------------------------
# At runtime, provide yy.node via the runner; no moduleInclude injection here.

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
