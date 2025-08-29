# bumps.coffee — SLR(1) grammar for M (MUMPS)
#
# Notes:
# - ELSE semantics (GT.M/VistA): ELSE/E takes effect based on $TEST and **does not support a postconditional**;
#   its scope is the remainder of the line (can be extended by DO/XECUTE). Source: GT.M PG "Else".

# - Mirrors CoffeeScript’s `grammar.coffee` structure (small `o()` helper, `exports.bnf`, `exports.operators`, `exports.lex`).
# - Assumes a stateful lexer with CMD/EXPR modes so keywords aren’t reserved and command spacing is honored.
# - Keeps M’s uniform, left‑to‑right precedence by putting all binary ops in the same `left` tier; unary handled with higher precedence.
# - Dot‑indent blocks are recorded per line via DOTS at line start; attach blocks in a post‑parse pass.
# - Pattern match (?), right operand is a PATTERN token for now. Swap in a sub‑grammar later if you want full validation.
# - M does not reserve keywords; CMD vs EXPR mode is required to disambiguate words like SET/IF used as names.
# - Spaces are syntactic: CMD→args vs command separators; handled via CS token + mode switches.
# - Dot‑indent blocks are recorded per line via DOTS; attach blocks in a post‑parse pass.
# - Flat precedence; unary > binary (token-name enums in AST)
# - CMD/EXPR/PAT/WEXPR modes; depth-aware spacing inside EXPR/WEXPR
# - WRITE adorners recognized only at top level of WEXPR items
# - Pattern subgrammar with counts/ranges on codes, literals, and groups
# - Extended references ^|"env-expr"|GLOBAL(...), plus naked extended ^|env|(…)
# - Naked global syntax ^(subs) yields NakedRef nodes (resolved later)
# - Tiny sample corpus included in exports.samples
# - Supports WRITE adorners (! ? # * /) with WEXPR gating
# - Supports pattern subgrammar and extended/naked global references

# -------------------------- helper --------------------------
o = (pattern, action = '', opts = undefined) ->
  # pattern: space‑separated Jison symbols (string)
  # action: CoffeeScript (compiled to JS) semantic action body
  # opts:   {prec: 'TOKEN', merge: true, etc.}
  [pattern, action, opts]

# -------------------------- grammar --------------------------
exports.startSymbol = 'program'

# Operator precedence (low → high) with tighter unary
exports.operators = [
  ['left',  'OR']
  ['left',  'AND']
  ['left',  'PMATCH']
  ['left',  'GT','LT','GE','LE','EQ','NE']
  ['left',  'CONTAINS','NCONTAINS','FOLLOWS','NFOLLOWS','SORTAFTER','NSORTAFTER']
  ['left',  'CONCAT']
  ['left',  'PLUS','MINUS']
  ['left',  'MUL','DIV','IDIV','MOD']
  ['right', 'EXP']
  ['right', 'UPLUS','UMINUS','NOT']
]

# Keep token list in sync with lexer below
exports.tokens = [

  # Core
  'NEWLINE','DOTS','LABEL','CS','COMMENT'
  'LPAREN','RPAREN','COMMA','COLON','CARET','AT','VBAR'
  'STRING','NUMBER','NAME'
  'DOLFN','DOLSPECVAR','ZDOLFN'
  'ZWRITE','ZBREAK','ZKILL','ZSYSTEM','ZETRAP','ZSHOW','ZLOAD','ZSAVE','ZCOMMAND'

  # Commands
  'BREAK','CLOSE','DO','ELSE','FOR','GOTO','HALT','HANG','IF','JOB','KILL'
  'LOCK','MERGE','NEW','OPEN','QUIT','READ','SET','USE','VIEW','WRITE','XECUTE'
  'TSTART','TCOMMIT','TROLLBACK','TRESTART'

  # Operators
  'OR','AND','NOT','CONCAT','GT','LT','GE','LE','EQ','NE','CONTAINS','NCONTAINS'
  'FOLLOWS','NFOLLOWS','SORTAFTER','NSORTAFTER'
  'PLUS','MINUS','MUL','DIV','IDIV','MOD','EXP'
  'PMATCH'

  # Pattern tokens (PAT mode)
  'P_NUM','P_CODE','P_DOT','PATTERN'

  # WRITE adornments (WEXPR mode)
  'WBANG','WTAB','WPOUND','WSTAR','WSLASH'
]

# ---------------------------------- intrinsics ----------------------------------
# Known M $FUNCTION names (and selected $spec variables) extracted from bumps-claude.bnf.
# Used for tooling/hints; parsing still accepts any $name and normalizes to uppercase.
exports.intrinsics = [
  'A'         , 'ASCII'     , 'C'         , 'CHAR'      , 'D'         , 'DATA'      ,
  'E'         , 'ECODE'     , 'ESTACK'    , 'ETRAP'     , 'EXTRACT'   , 'F'         ,
  'FIND'      , 'FNUMBER'   , 'G'         , 'GET'       , 'H'         , 'HOROLOG'   ,
  'INCREMENT' , 'IO'        , 'J'         , 'JOB'       , 'JUSTIFY'   , 'L'         ,
  'LENGTH'    , 'NA'        , 'NAME'      , 'NEXT'      , 'O'         , 'ORDER'     ,
  'P'         , 'PIECE'     , 'PRINCIPAL' , 'Q'         , 'QLENGTH'   , 'QSUBSCRIPT',
  'QUERY'     , 'QUIT'      , 'R'         , 'RANDOM'    , 'RE'        , 'REVERSE'   ,
  'S'         , 'SELECT'    , 'STACK'     , 'STORAGE'   , 'T'         , 'TEST'      ,
  'TEXT'      , 'TLEVEL'    , 'TR'        , 'TRANSLATE' , 'V'         , 'VIEW'      ,
  'X'         , 'Y'         , 'ZDATE'     , 'ZETRAP'    , 'ZTRAP'     , 'ZVERSION'
]

# Helper: check if a $FUNCTION name is recognized (uppercase, without '$')
# NOTE: Currently, this is only used for tooling/hints. Add to restrict fn names.
exports.isKnownIntrinsic = (name) -> name in exports.intrinsics

# ---------------------------------- options ----------------------------------
# Feature gates for writable system variables in the grammar.
# Consumers can set parser.yy.options = { allowWritableDeviceVars: true, allowWritableSystemVar: true }
exports.options =
  allowWritableDeviceVars: false
  allowWritableSystemVar: false

exports.bnf =

  # ---- program structure ----
  program: [
    o ''      , 'return yy.node("Program", {lines: []})'
    o 'lines' , 'return yy.node("Program", {lines: $1})'
  ]

  lines: [
    o 'line'               , '$$ = [$1]'
    o 'lines NEWLINE line' , '$1.push($3); $$ = $1'
    o 'lines NEWLINE'      , '$$ = $1'
  ]

  line: [
    o 'line_hdr opt_cmds opt_comment' , '$$ = Object.assign($1, {cmds: $2, comment: $3 || null})'
    o 'line_hdr opt_comment'          , '$$ = Object.assign($1, {cmds: [], comment: $2 || null})'
    o 'error'                          , '$$ = yy.node("LineError", {})'
  ]

  line_hdr: [
    o 'opt_dots opt_label' , '$$ = yy.node("Line", {depth: $1, label: $2})'
    o 'opt_dots'           , '$$ = yy.node("Line", {depth: $1, label: null})'
  ]

  opt_dots: [
    o 'DOTS' , '$$ = (typeof yytext === "string" ? yytext.length : (yy.depth|0))'
    o ''     , '$$ = 0'
  ]

  opt_label: [
    o 'LABEL opt_formals' , '$$ = yy.node("Label", {name: $1, formals: $2})'
    o ''                  , '$$ = null'
  ]

  opt_formals: [
    o 'LPAREN formals RPAREN' , '$$ = $2'
    o ''                      , '$$ = []'
  ]

  formals: [
    o 'NAME'               , '$$ = [ yy.node("Formal", {name: $1}) ]'
    o 'formals COMMA NAME' , '$1.push(yy.node("Formal", {name: $3})); $$ = $1'
  ]

  opt_comment: [
    o 'COMMENT' , '$$ = yytext'
    o ''        , '$$ = null'
  ]

  opt_cmds: [
    o 'cmds' , '$$ = $1'
    o ''     , '$$ = []'
  ]

  cmds: [
    o 'cmd'         , '$$ = [$1]'
    o 'cmds CS cmd' , '$1.push($3); $$ = $1'
  ]

  # ---- commands ----
  cmd: [
    # Pre-command postcondition (optional CS)
    o 'postcond CS cmd' , 'var c=$3; if (c&& (c.type==="Cmd"||c.type==="For"||c.type==="If"||c.type==="Else")) c.pc=$1; $$=c;'
    o 'postcond cmd'    , 'var c=$2; if (c&& (c.type==="Cmd"||c.type==="For"||c.type==="If"||c.type==="Else")) c.pc=$1; $$=c;'
    # GOTO
    o 'GOTO postcond CS goto_list' , '$$ = yy.node("Cmd", {pc: $2, op: "GOTO", args: $4})'
    o 'GOTO CS goto_list'          , '$$ = yy.node("Cmd", {pc: null, op: "GOTO", args: $3})'

    # SET (must have args)
    o 'SET postcond CS set_list' , '$$ = yy.node("Cmd", {pc: $2, op: "SET",   args: $4})'
    o 'SET CS set_list'          , '$$ = yy.node("Cmd", {pc: null, op: "SET", args: $3})'

    # WRITE
    o 'WRITE postcond CS write_list' , '$$ = yy.node("Cmd", {pc: $2, op: "WRITE", args: $4})'
    o 'WRITE CS write_list'          , '$$ = yy.node("Cmd", {pc: null, op: "WRITE",args: $3})'

    # READ
    o 'READ postcond CS read_list' , '$$ = yy.node("Cmd", {pc: $2, op: "READ",  args: $4})'
    o 'READ CS read_list'          , '$$ = yy.node("Cmd", {pc: null, op: "READ", args: $3})'

    # NEW
    o 'NEW postcond CS name_list' , '$$ = yy.node("Cmd", {pc: $2, op: "NEW",   args: yy.node("ArgsNEW", {names: $4})})'
    o 'NEW CS name_list'          , '$$ = yy.node("Cmd", {pc: null, op: "NEW", args: yy.node("ArgsNEW", {names: $3})})'

    # OPEN (device params)
    o 'OPEN postcond CS device_args' , '$$ = yy.node("Cmd", {pc: $2, op: "OPEN", args: $4})'
    o 'OPEN CS device_args'          , '$$ = yy.node("Cmd", {pc: null, op: "OPEN", args: $3})'

    # USE (device params)
    o 'USE postcond CS device_args'  , '$$ = yy.node("Cmd", {pc: $2, op: "USE",  args: $4})'
    o 'USE CS device_args'           , '$$ = yy.node("Cmd", {pc: null, op: "USE", args: $3})'

    # VIEW (device params)
    o 'VIEW postcond CS device_args' , '$$ = yy.node("Cmd", {pc: $2, op: "VIEW", args: $4})'
    o 'VIEW CS device_args'          , '$$ = yy.node("Cmd", {pc: null, op: "VIEW", args: $3})'

    # XECUTE (exprlist)
    o 'XECUTE postcond CS exprlist' , '$$ = yy.node("Cmd", {pc: $2, op: "XECUTE", args: $4})'
    o 'XECUTE CS exprlist'          , '$$ = yy.node("Cmd", {pc: null, op: "XECUTE", args: $3})'

    # Transactions
    o 'TSTART postcond CS exprlist' , '$$ = yy.node("Cmd", {pc: $2, op: "TSTART",   args: $4})'
    o 'TSTART CS exprlist'          , '$$ = yy.node("Cmd", {pc: null, op: "TSTART", args: $3})'
    o 'TSTART postcond'             , '$$ = yy.node("Cmd", {pc: $2, op: "TSTART",   args: []})'
    o 'TSTART'                      , '$$ = yy.node("Cmd", {pc: null, op: "TSTART", args: []})'

    o 'TCOMMIT postcond'            , '$$ = yy.node("Cmd", {pc: $2, op: "TCOMMIT", args: []})'
    o 'TCOMMIT'                     , '$$ = yy.node("Cmd", {pc: null, op: "TCOMMIT", args: []})'

    o 'TROLLBACK postcond'          , '$$ = yy.node("Cmd", {pc: $2, op: "TROLLBACK", args: []})'
    o 'TROLLBACK'                   , '$$ = yy.node("Cmd", {pc: null, op: "TROLLBACK", args: []})'

    o 'TRESTART postcond CS exprlist' , '$$ = yy.node("Cmd", {pc: $2, op: "TRESTART",   args: $4})'
    o 'TRESTART CS exprlist'          , '$$ = yy.node("Cmd", {pc: null, op: "TRESTART", args: $3})'
    o 'TRESTART postcond'             , '$$ = yy.node("Cmd", {pc: $2, op: "TRESTART",   args: []})'
    o 'TRESTART'                      , '$$ = yy.node("Cmd", {pc: null, op: "TRESTART", args: []})'

    # CLOSE (device params)
    o 'CLOSE postcond CS device_args' , '$$ = yy.node("Cmd", {pc: $2, op: "CLOSE", args: $4})'
    o 'CLOSE CS device_args'          , '$$ = yy.node("Cmd", {pc: null, op: "CLOSE", args: $3})'
    o 'CLOSE postcond'             , '$$ = yy.node("Cmd", {pc: $2, op: "CLOSE", args: []})'
    o 'CLOSE'                      , '$$ = yy.node("Cmd", {pc: null, op: "CLOSE", args: []})'

    # FOR
    o 'FOR postcond CS for_specs' , '$$ = yy.node("For", {pc: $2, specs: $4})'
    o 'FOR CS for_specs'          , '$$ = yy.node("For", {pc: null, specs: $3})'
    # Bare FOR (acts as DO-loop starter)
    o 'FOR'                       , '$$ = yy.node("For", {pc: null, specs: []})'

    # JOB (targets with optional params) and argumentless form
    o 'JOB postcond CS job_targets' , '$$ = yy.node("Cmd", {pc: $2, op: "JOB",  args: $4})'
    o 'JOB CS job_targets'          , '$$ = yy.node("Cmd", {pc: null, op: "JOB", args: $3})'
    o 'JOB postcond'                , '$$ = yy.node("Cmd", {pc: $2, op: "JOB",  args: []})'
    o 'JOB'                         , '$$ = yy.node("Cmd", {pc: null, op: "JOB", args: []})'

    # Specific Z-commands with proper argument structures
    # ZWRITE - Display variables with their values (GT.M/Caché)
    o 'ZWRITE postcond CS zwrite_items' , '$$ = yy.node("Cmd", {pc: $2, op: "ZWRITE", args: yy.node("ArgsZWRITE", {items: $4})})'
    o 'ZWRITE CS zwrite_items'          , '$$ = yy.node("Cmd", {pc: null, op: "ZWRITE", args: yy.node("ArgsZWRITE", {items: $3})})'
    o 'ZWRITE postcond'                 , '$$ = yy.node("Cmd", {pc: $2, op: "ZWRITE", args: yy.node("ArgsZWRITE", {items: []})})'
    o 'ZWRITE'                          , '$$ = yy.node("Cmd", {pc: null, op: "ZWRITE", args: yy.node("ArgsZWRITE", {items: []})})'

    # ZBREAK - Set/clear breakpoints at entry references (GT.M)
    o 'ZBREAK postcond CS zbreak_list' , '$$ = yy.node("Cmd", {pc: $2, op: "ZBREAK", args: yy.node("ArgsZBREAK", {targets: $4})})'
    o 'ZBREAK CS zbreak_list'          , '$$ = yy.node("Cmd", {pc: null, op: "ZBREAK", args: yy.node("ArgsZBREAK", {targets: $3})})'
    o 'ZBREAK postcond'                , '$$ = yy.node("Cmd", {pc: $2, op: "ZBREAK", args: yy.node("ArgsZBREAK", {targets: []})})'
    o 'ZBREAK'                         , '$$ = yy.node("Cmd", {pc: null, op: "ZBREAK", args: yy.node("ArgsZBREAK", {targets: []})})'

    # ZKILL - Kill local variable (but not descendants) (GT.M/Caché)
    o 'ZKILL postcond CS zkill_items'  , '$$ = yy.node("Cmd", {pc: $2, op: "ZKILL", args: yy.node("ArgsZKILL", {items: $4})})'
    o 'ZKILL CS zkill_items'           , '$$ = yy.node("Cmd", {pc: null, op: "ZKILL", args: yy.node("ArgsZKILL", {items: $3})})'

    # ZSYSTEM - Execute OS command (GT.M)
    o 'ZSYSTEM postcond CS expr'       , '$$ = yy.node("Cmd", {pc: $2, op: "ZSYSTEM", args: [$4]})'
    o 'ZSYSTEM CS expr'                , '$$ = yy.node("Cmd", {pc: null, op: "ZSYSTEM", args: [$3]})'
    o 'ZSYSTEM'                        , '$$ = yy.node("Cmd", {pc: null, op: "ZSYSTEM", args: []})'

    # ZETRAP - Set error trap (GT.M/Caché)
    o 'ZETRAP postcond CS expr'        , '$$ = yy.node("Cmd", {pc: $2, op: "ZETRAP", args: [$4]})'
    o 'ZETRAP CS expr'                 , '$$ = yy.node("Cmd", {pc: null, op: "ZETRAP", args: [$3]})'

    # ZSHOW - Show system information (GT.M)
    o 'ZSHOW postcond CS expr'         , '$$ = yy.node("Cmd", {pc: $2, op: "ZSHOW", args: [$4]})'
    o 'ZSHOW CS expr'                  , '$$ = yy.node("Cmd", {pc: null, op: "ZSHOW", args: [$3]})'

    # ZLOAD/ZSAVE - Load/save routines (GT.M)
    o 'ZLOAD postcond CS expr'         , '$$ = yy.node("Cmd", {pc: $2, op: "ZLOAD", args: [$4]})'
    o 'ZLOAD CS expr'                  , '$$ = yy.node("Cmd", {pc: null, op: "ZLOAD", args: [$3]})'
    o 'ZSAVE postcond CS expr'         , '$$ = yy.node("Cmd", {pc: $2, op: "ZSAVE", args: [$4]})'
    o 'ZSAVE CS expr'                  , '$$ = yy.node("Cmd", {pc: null, op: "ZSAVE", args: [$3]})'

    # Generic Z-commands (fallback for other vendor-specific commands)
    o 'ZCOMMAND postcond CS exprlist'  , '$$ = yy.node("Cmd", {pc: $2, op: $1, args: $4})'
    o 'ZCOMMAND CS exprlist'           , '$$ = yy.node("Cmd", {pc: null, op: $1, args: $3})'
    o 'ZCOMMAND'                       , '$$ = yy.node("Cmd", {pc: null, op: $1, args: []})'

    # Indirect command execution (ELSE IF already chains; here we allow @NAME and @(expr) as a command)
    o 'AT NAME CS exprlist'              , '$$ = yy.node("Cmd", {pc: null, op: "INDIRECT", args: yy.node("ArgsINDIRECT", {target: yy.node("Indirect", {kind:"name", target:$2}), args:$4})})'
    o 'AT NAME'                          , '$$ = yy.node("Cmd", {pc: null, op: "INDIRECT", args: yy.node("ArgsINDIRECT", {target: yy.node("Indirect", {kind:"name", target:$2}), args:[]})})'
    o 'AT LPAREN expr RPAREN CS exprlist', '$$ = yy.node("Cmd", {pc: null, op: "INDIRECT", args: yy.node("ArgsINDIRECT", {target: yy.node("Indirect", {kind:"expr", target:$3}), args:$6})})'
    o 'AT LPAREN expr RPAREN'            , '$$ = yy.node("Cmd", {pc: null, op: "INDIRECT", args: yy.node("ArgsINDIRECT", {target: yy.node("Indirect", {kind:"expr", target:$3}), args:[]})})'

    # KILL
    o 'KILL postcond CS kill_items' , '$$ = yy.node("Cmd", {pc: $2, op: "KILL",  args: yy.node("ArgsKILL", {items: $4})})'
    o 'KILL CS kill_items'          , '$$ = yy.node("Cmd", {pc: null, op: "KILL", args: yy.node("ArgsKILL", {items: $3})})'
    o 'KILL postcond'               , '$$ = yy.node("Cmd", {pc: $2, op: "KILL",  args: yy.node("ArgsKILL", {items: []})})'
    o 'KILL'                        , '$$ = yy.node("Cmd", {pc: null, op: "KILL", args: yy.node("ArgsKILL", {items: []})})'

    # DO
    o 'DO postcond CS entryref_list' , '$$ = yy.node("Cmd", {pc: $2, op: "DO",    args: yy.node("ArgsENTRY", {targets: $4})})'
    o 'DO CS entryref_list'          , '$$ = yy.node("Cmd", {pc: null, op: "DO",  args: yy.node("ArgsENTRY", {targets: $3})})'
    o 'DO postcond'                  , '$$ = yy.node("Cmd", {pc: $2, op: "DO",    args: yy.node("ArgsENTRY", {targets: []})})'
    o 'DO'                           , '$$ = yy.node("Cmd", {pc: null, op: "DO",  args: yy.node("ArgsENTRY", {targets: []})})'

    # IF (expr required, no postcond - that's handled by cmd wrapper)
    # Comma-separated conditions create nested IFs (all must be true)
    o 'IF CS if_conditions'         , '$$ = yy.node("If", {pc: null, cond: $3})'

    # ELSE (argless)
    o 'ELSE'                        , '$$ = yy.node("Else", {pc: null})'

    # LOCK / MERGE
    o 'LOCK postcond CS lock_items' , '$$ = yy.node("Cmd", {pc: $2, op: "LOCK",  args: $4})'
    o 'LOCK CS lock_items'          , '$$ = yy.node("Cmd", {pc: null, op: "LOCK", args: $3})'

    o 'MERGE postcond CS merge_items' , '$$ = yy.node("Cmd", {pc: $2, op: "MERGE", args: $4})'
    o 'MERGE CS merge_items'          , '$$ = yy.node("Cmd", {pc: null, op: "MERGE",args: $3})'

    # HALT / BREAK (argless)
    o 'HALT postcond' , '$$ = yy.node("Cmd", {pc: $2, op: "HALT", args: []})'
    o 'HALT'          , '$$ = yy.node("Cmd", {pc: null, op: "HALT", args: []})'

    o 'BREAK postcond' , '$$ = yy.node("Cmd", {pc: $2, op: "BREAK", args: []})'
    o 'BREAK'          , '$$ = yy.node("Cmd", {pc: null, op: "BREAK", args: []})'

    # QUIT (optional expr)
    o 'QUIT postcond CS expr' , '$$ = yy.node("Cmd", {pc: $2, op: "QUIT", args: [$4]})'
    o 'QUIT CS expr'          , '$$ = yy.node("Cmd", {pc: null, op: "QUIT", args: [$3]})'
    o 'QUIT postcond'         , '$$ = yy.node("Cmd", {pc: $2, op: "QUIT", args: []})'
    o 'QUIT'                  , '$$ = yy.node("Cmd", {pc: null, op: "QUIT", args: []})'

    # HANG (optional expr)
    o 'HANG postcond CS expr' , '$$ = yy.node("Cmd", {pc: $2, op: "HANG", args: [$4]})'
    o 'HANG CS expr'          , '$$ = yy.node("Cmd", {pc: null, op: "HANG", args: [$3]})'
    o 'HANG postcond'         , '$$ = yy.node("Cmd", {pc: $2, op: "HANG", args: []})'
    o 'HANG'                  , '$$ = yy.node("Cmd", {pc: null, op: "HANG", args: []})'
  ]

  postcond: [ o 'COLON expr', '$$ = $2' ]

  # ---- argument lists ----
  set_list: [ o 'set_items', '$$ = yy.node("ArgsSET", {items: $1})' ]
  set_items: [
    o 'set_item'                 , '$$ = [$1]'
    o 'set_items COMMA set_item' , '$1.push($3); $$ = $1'
  ]
  set_item: [
    o 'set_target EQ expr'                  , '$$ = yy.node("Set", {lhs: $1, rhs: $3})'
  ]

  set_target: [
    o 'varref'         , '$$ = $1'
    o 'dolspecial_lhs' , '$$ = $1'
    o 'piece_lhs'      , '$$ = $1'
    o 'extract_lhs'    , '$$ = $1'
    # Direct NAME form to ensure simple locals like X, Y(1) parse as LHS without ambiguity
    o 'NAME opt_subs'  , '$$ = yy.node("Var", {global: false, name: $1, subs: $2})'
  ]

  # KILL
  kill_items: [
    o 'lvalue'                               , '$$ = [$1]'
    o 'LPAREN kill_group_items RPAREN'       , '$$ = $2'
    o 'kill_items COMMA lvalue'              , '$1.push($3); $$ = $1'
    o 'kill_items COMMA LPAREN kill_group_items RPAREN' , '$1.push.apply($1,$4); $$ = $1'
  ]
  kill_group_items: [
    o 'lvalue'                                   , '$$ = [$1]'
    o 'LPAREN kill_group_items RPAREN'           , '$$ = $2'
    o 'kill_group_items COMMA lvalue'            , '$1.push($3); $$ = $1'
    o 'kill_group_items COMMA LPAREN kill_group_items RPAREN' , '$1.push.apply($1,$4); $$ = $1'
  ]

  # NEW
  name_list: [
    o 'NAME'                 , '$$ = [$1]'
    o 'AT NAME'              , '$$ = [ yy.node("Indirect", {kind:"name", target:$2}) ]'
    o 'AT LPAREN expr RPAREN', '$$ = [ yy.node("Indirect", {kind:"expr", target:$3}) ]'
    o 'LPAREN name_list RPAREN' , '$$ = $2'
    o 'name_list COMMA NAME' , '$1.push($3); $$ = $1'
    o 'name_list COMMA AT NAME' , '$1.push(yy.node("Indirect", {kind:"name", target:$4})); $$ = $1'
    o 'name_list COMMA AT LPAREN expr RPAREN' , '$1.push(yy.node("Indirect", {kind:"expr", target:$5})); $$ = $1'
    o 'name_list COMMA LPAREN name_list RPAREN' , '$1.push.apply($1,$4); $$ = $1'
  ]

  # DO / GOTO share entryref_list
  entryref_list: [
    o 'entryref'                     , '$$ = [$1]'
    o 'entryref_list COMMA entryref' , '$1.push($3); $$ = $1'
  ]
  entryref: [
    o 'NAME opt_entryargs'                         , '$$ = yy.node("EntryRef", {label: $1, routine: null, offset: null, args: $2})'
    o 'NAME CARET NAME opt_entryargs'              , '$$ = yy.node("EntryRef", {label: $1, routine: $3,  offset: null, args: $4})'
    o 'NAME PLUS NUMBER CARET NAME opt_entryargs'  , '$$ = yy.node("EntryRef", {label: $1, routine: $5,  offset: +$3, args: $6})'
    o 'NAME MINUS NUMBER CARET NAME opt_entryargs' , '$$ = yy.node("EntryRef", {label: $1, routine: $5,  offset: -$3, args: $6})'
    o 'CARET NAME opt_entryargs'                   , '$$ = yy.node("EntryRef", {label: null, routine: $2, offset: null, args: $3})'

    o 'AT NAME opt_entryargs'                      , '$$ = yy.node("EntryRef", {label: null, routine: null, offset: null, args: $3, indirect: yy.node("Indirect", {kind: "name", target: $2})})'
    o 'AT LPAREN expr RPAREN opt_entryargs'        , '$$ = yy.node("EntryRef", {label: null, routine: null, offset: null, args: $5, indirect: yy.node("Indirect", {kind: "expr", target: $3})})'
  ]
  opt_entryargs: [
    o 'LPAREN exprlist RPAREN' , '$$ = $2'
    o ''                       , '$$ = []'
  ]

  # WRITE
  write_list: [ o 'witems', '$$ = yy.node("ArgsWRITE", {items: $1})' ]
  witems: [
    o 'witem'              , '$$ = [$1]'
    o 'witems COMMA witem' , '$1.push($3); $$ = $1'
  ]
  witem: [
    o 'WTAB expr'   , '$$ = yy.node("WTab",    {expr: $2})'
    o 'WBANG'       , '$$ = yy.node("WNL",     {})'
    o 'WPOUND'      , '$$ = yy.node("WFF",     {})'
    o 'WSTAR expr'  , '$$ = yy.node("WAscii",  {expr: $2})'
    o 'WSLASH expr' , '$$ = yy.node("WFormat", {expr: $2})'
    o 'expr'        , '$$ = ($1 && $1.type === "PatternMatch") ? $1 : yy.node("WExpr", {expr: $1})'
  ]

  # READ
  read_list: [ o 'ritems', '$$ = yy.node("ArgsREAD", {items: $1})' ]
  ritems: [
    o 'ritem'              , '$$ = [$1]'
    o 'ritems COMMA ritem' , '$1.push($3); $$ = $1'
  ]
  ritem: [
    o 'lvalue'            , '$$ = yy.node("ReadItem", {lhs: $1, timeout: null})'
    o 'lvalue COLON expr' , '$$ = yy.node("ReadItem", {lhs: $1, timeout: $3})'
    # READ *X - single character read
    o 'MUL lvalue'        , '$$ = yy.node("ReadChar", {lhs: $2})'
    o 'MUL lvalue COLON expr' , '$$ = yy.node("ReadChar", {lhs: $2, timeout: $4})'
    # READ X#5 - fixed length read
    o 'lvalue MOD expr' , '$$ = yy.node("ReadFixed", {lhs: $1, length: $3})'
    o 'lvalue MOD expr COLON expr' , '$$ = yy.node("ReadFixed", {lhs: $1, length: $3, timeout: $5})'
    # READ "Prompt: ",X - prompt with read
    o 'STRING COMMA lvalue', '$$ = yy.node("ReadPrompt", {prompt: $1, lhs: $3})'
    o 'STRING COMMA lvalue COLON expr', '$$ = yy.node("ReadPrompt", {prompt: $1, lhs: $3, timeout: $5})'
  ]

  # LOCK
  lock_items: [
    o 'lock_item'                  , '$$ = [$1]'
    o 'lock_items COMMA lock_item' , '$1.push($3); $$ = $1'
  ]
  lock_item: [
    o 'lvalue'            , '$$ = yy.node("LockItem", {res: $1, timeout: null})'
    o 'lvalue COLON expr' , '$$ = yy.node("LockItem", {res: $1, timeout: $3})'
    o 'PLUS lvalue'                 , '$$ = yy.node("LockItem", {res: $2, timeout: null, delta: "inc"})'
    o 'PLUS lvalue COLON expr'      , '$$ = yy.node("LockItem", {res: $2, timeout: $4,   delta: "inc"})'
    o 'MINUS lvalue'                , '$$ = yy.node("LockItem", {res: $2, timeout: null, delta: "dec"})'
    o 'MINUS lvalue COLON expr'     , '$$ = yy.node("LockItem", {res: $2, timeout: $4,   delta: "dec"})'
  ]

  # MERGE
  merge_items: [
    o 'merge_item'                               , '$$ = Array.isArray($1)?$1:[$1]'
    o 'merge_items COMMA merge_item'             , 'if(Array.isArray($3)) $1.push.apply($1,$3); else $1.push($3); $$ = $1'
  ]
  merge_item: [
    o 'lvalue EQ lvalue'                         , '$$ = yy.node("Merge", {target: $1, source: $3})'
    # Multi-target shorthand: (A,B)=C → [Merge(A=C), Merge(B=C)]
    o 'LPAREN merge_targets RPAREN EQ lvalue'    , '$$ = $2.map(function(t){ return yy.node("Merge", {target:t, source:$5}); })'
  ]
  merge_targets: [
    o 'lvalue'                      , '$$ = [$1]'
    o 'merge_targets COMMA lvalue'  , '$1.push($3); $$ = $1'
  ]

  # GOTO targets reuse entryref
  goto_list: [ o 'entryref_list', '$$ = $1' ]

  # Z-command argument lists
  # ZWRITE - variable list (similar to KILL but simpler - no exclusive kill)
  zwrite_items: [
    o 'lvalue'                       , '$$ = [$1]'
    o 'zwrite_items COMMA lvalue'   , '$1.push($3); $$ = $1'
  ]

  # ZKILL - same as ZWRITE (kill variable without descendants)
  zkill_items: [
    o 'lvalue'                       , '$$ = [$1]'
    o 'zkill_items COMMA lvalue'    , '$1.push($3); $$ = $1'
  ]

  # ZBREAK - entry references with optional action expressions
  zbreak_list: [
    o 'zbreak_item'                   , '$$ = [$1]'
    o 'zbreak_list COMMA zbreak_item' , '$1.push($3); $$ = $1'
  ]
  zbreak_item: [
    # Entry reference with optional action (e.g., ZBREAK LABEL^ROUTINE:"WRITE ""BREAK""")
    o 'entryref'                      , '$$ = yy.node("ZBreakItem", {target: $1, action: null})'
    o 'entryref COLON expr'           , '$$ = yy.node("ZBreakItem", {target: $1, action: $3})'
    # Clear breakpoint with minus prefix
    o 'MINUS entryref'                , '$$ = yy.node("ZBreakItem", {target: $2, action: null, clear: true})'
  ]

  # ---- IF conditions (comma creates nested IFs - all must be true) ----
  if_conditions: [
    o 'expr'                        , '$$ = $1'
    o 'if_conditions COMMA expr'    , '$$ = yy.node("BinOp", {op:"AND", lhs:$1, rhs:$3})'
  ]

  # ---- expressions ----
  expr: [
    o 'primary' , '$$ = $1'

    # binary ops
    o 'expr PLUS expr'   , '$$ = yy.node("BinOp", {op:"PLUS",    lhs:$1, rhs:$3})'
    o 'expr MINUS expr'  , '$$ = yy.node("BinOp", {op:"MINUS",   lhs:$1, rhs:$3})'
    o 'expr MUL expr'    , '$$ = yy.node("BinOp", {op:"MUL",     lhs:$1, rhs:$3})'
    o 'expr EXP expr'    , '$$ = yy.node("BinOp", {op:"EXP",     lhs:$1, rhs:$3})'
    o 'expr DIV expr'    , '$$ = yy.node("BinOp", {op:"DIV",     lhs:$1, rhs:$3})'
    o 'expr IDIV expr'   , '$$ = yy.node("BinOp", {op:"IDIV",    lhs:$1, rhs:$3})'
    o 'expr MOD expr'    , '$$ = yy.node("BinOp", {op:"MOD",     lhs:$1, rhs:$3})'
    o 'expr AND expr'    , '$$ = yy.node("BinOp", {op:"AND",     lhs:$1, rhs:$3})'
    o 'expr OR expr'     , '$$ = yy.node("BinOp", {op:"OR",      lhs:$1, rhs:$3})'
    o 'expr CONCAT expr' , '$$ = yy.node("BinOp", {op:"CONCAT",  lhs:$1, rhs:$3})'

    # relations
    o 'expr GT expr'         , '$$ = yy.node("Rel",   {op:"GT",         lhs:$1, rhs:$3})'
    o 'expr LT expr'         , '$$ = yy.node("Rel",   {op:"LT",         lhs:$1, rhs:$3})'
    o 'expr GE expr'         , '$$ = yy.node("Rel",   {op:"GE",         lhs:$1, rhs:$3})'
    o 'expr LE expr'         , '$$ = yy.node("Rel",   {op:"LE",         lhs:$1, rhs:$3})'
    o 'expr EQ expr'         , '$$ = yy.node("Rel",   {op:"EQ",         lhs:$1, rhs:$3})'
    o 'expr NE expr'         , '$$ = yy.node("Rel",   {op:"NE",         lhs:$1, rhs:$3})'
    o 'expr CONTAINS expr'   , '$$ = yy.node("Rel",   {op:"CONTAINS",   lhs:$1, rhs:$3})'
    o 'expr NCONTAINS expr'  , '$$ = yy.node("Rel",   {op:"NCONTAINS",  lhs:$1, rhs:$3})'
    o 'expr FOLLOWS expr'    , '$$ = yy.node("Rel",   {op:"FOLLOWS",    lhs:$1, rhs:$3})'
    o 'expr NFOLLOWS expr'   , '$$ = yy.node("Rel",   {op:"NFOLLOWS",   lhs:$1, rhs:$3})'
    o 'expr SORTAFTER expr'  , '$$ = yy.node("Rel",   {op:"SORTAFTER",  lhs:$1, rhs:$3})'
    o 'expr NSORTAFTER expr' , '$$ = yy.node("Rel",   {op:"NSORTAFTER", lhs:$1, rhs:$3})'

    # pattern match (positive and negative operator forms)
    o 'expr PMATCH pattern'     , '$$ = yy.node("PatternMatch", {op:"PMATCH",  lhs:$1, pat:$3})'
    o 'expr NOT PMATCH pattern' , '$$ = yy.node("PatternMatch", {op:"NPMATCH", lhs:$1, pat:$4})'
  ]

  primary: [
    o 'NUMBER'             , '$$ = yy.node("Number", {value: +yytext})'
    o 'STRING'             , '$$ = yy.node("String", {value: yytext})'
    o 'varref'             , '$$ = $1'
    o 'LPAREN expr RPAREN' , '$$ = $2'
    o 'dolfn_call'         , '$$ = $1'
    # unary operators as primary
    o 'NOT primary'        , '$$ = yy.node("UnOp", {op:"NOT",    expr:$2})'
    o 'PLUS primary'       , '$$ = yy.node("UnOp", {op:"UPLUS",  expr:$2})'
    o 'MINUS primary'      , '$$ = yy.node("UnOp", {op:"UMINUS", expr:$2})'
  ]

  # unified variable references
  varref: [
    o 'opt_global NAME opt_subs' , '$$ = yy.node("Var", {global: $1, name: $2, subs: $3})'

    # Naked global reference: ^(subscripts) or ^|"env-expr"|(...)
    o 'CARET LPAREN exprlist RPAREN'                , '$$ = yy.node("NakedRef", {env: null, subs: $3})'
    o 'CARET VBAR expr VBAR LPAREN exprlist RPAREN' , '$$ = yy.node("NakedRef", {env: $3, subs: $6})'

    # Extended reference: ^|"env-expr"|NAME(opt_subs)
    o 'CARET VBAR expr VBAR NAME opt_subs' , '$$ = yy.node("Var", {global:true, env:$3, name:$5, subs:$6})'

    # Indirection
    o 'AT NAME'               , '$$ = yy.node("Indirect", {kind: "name", target: $2})'
    o 'AT LPAREN expr RPAREN' , '$$ = yy.node("Indirect", {kind: "expr", target: $3})'
  ]

  opt_subs: [
    o 'LPAREN exprlist RPAREN' , '$$ = $2'
    o ''                       , '$$ = []'
  ]

  opt_global: [
    o 'CARET' , '$$ = true'
    o ''      , '$$ = false'
  ]

  exprlist: [
    o 'expr'                , '$$ = [$1]'
    o 'exprlist COMMA expr' , '$1.push($3); $$ = $1'
  ]

  dolfn_call: [
    o 'DOLFN'                        , '$$ = yy.node("DollarFn", {name: $1, args: []})'
    o 'DOLFN LPAREN exprlist RPAREN'  , '$$ = yy.node("DollarFn", {name: $1, args: $3})'
    o 'DOLSPECVAR'                    , '$$ = yy.node("DollarVar", {name: $1})'
    o 'ZDOLFN'                       , '$$ = yy.node("DollarFn", {name: $1, zext: true, args: []})'
    o 'ZDOLFN LPAREN exprlist RPAREN' , '$$ = yy.node("DollarFn", {name: $1, zext: true, args: $3})'
  ]

  # lvalue for non-SET LHS
  lvalue: [ o 'varref', '$$ = $1' ]

  # ---- Device parameter lists ----
  device_args: [ o 'device_specs', '$$ = yy.node("ArgsDEVICE", {specs: $1})' ]
  device_specs: [
    o 'device_spec'                    , '$$ = [$1]'
    o 'device_specs COMMA device_spec' , '$1.push($3); $$ = $1'
  ]
  device_spec: [
    o 'expr opt_dev_params' , '$$ = yy.node("DeviceSpec", {device: $1, params: $2})'
  ]
  opt_dev_params: [
    o 'COLON expr opt_more_dev_params' , '$$ = [$2].concat($3)'
    o ''                               , '$$ = []'
  ]
  opt_more_dev_params: [
    o 'COLON expr opt_more_dev_params' , '$$ = [$2].concat($3)'
    o ''                               , '$$ = []'
  ]

  # ---- JOB targets with optional params ----
  job_targets: [
    o 'job_target'                    , '$$ = [$1]'
    o 'job_targets COMMA job_target'  , '$1.push($3); $$ = $1'
  ]
  job_target: [
    o 'entryref opt_job_params' , '$$ = yy.node("JobTarget", {target: $1, params: $2})'
  ]
  opt_job_params: [
    o 'COLON expr opt_more_job_params' , '$$ = [$2].concat($3)'
    o ''                                , '$$ = []'
  ]
  opt_more_job_params: [
    o 'COLON expr opt_more_job_params' , '$$ = [$2].concat($3)'
    o ''                                , '$$ = []'
  ]

  # ---- Pattern subgrammar ----
  pattern: [
    o 'pat_seq'  , '$$ = yy.node("Pattern", {atoms: $1})'
    o 'PATTERN'  , '$$ = (yy.parsePattern ? yy.parsePattern(yytext) : yy.node("PatternRaw", {src: yytext}))'
  ]

  pat_seq: [
    o 'pat_seq pat_atom' , '$1.push($2); $$ = $1'
    o 'pat_atom'         , '$$ = [$1]'
  ]

  pat_repeatable: [
    o 'P_CODE'                , '$$ = yy.node("PCode", {code: $1})'
    o 'STRING'                , '$$ = yy.node("PLit",  {value: yytext})'
    o 'LPAREN pat_alt RPAREN' , '$$ = yy.node("PGroup",{alts: $2})'
  ]

  pat_atom: [
    o 'P_NUM P_DOT P_NUM pat_repeatable' , '$$ = yy.node("PRange", {min:+$1, max:+$3, what:$4})'
    o 'P_NUM pat_repeatable'             , '$$ = yy.node("PCount", {count:+$1, what:$2})'
    o 'pat_repeatable'                   , '$$ = $1'
  ]

  pat_alt: [
    o 'pat_alt COMMA pat_seq' , '$1.push($3); $$ = $1'
    o 'pat_seq'               , '$$ = [$1]'
  ]

  # ---- SET-only LHS helpers (simplified placeholders) ----
  dolspecial_lhs: [ o 'DOLSPECVAR',                   '$$ = yy.node("DollarVar", {name: $1, writable: true})' ]
  piece_lhs:      [ o 'DOLFN LPAREN exprlist RPAREN', '$$ = yy.node("PieceLHS",   {call: yy.node("DollarFn", {name:$1, args:$3})})' ]
  extract_lhs:    [ o 'DOLFN LPAREN exprlist RPAREN', '$$ = yy.node("ExtractLHS", {call: yy.node("DollarFn", {name:$1, args:$3})})' ]

  # ---- FOR header parsing ----
  for_specs: [
    o 'for_spec'                 , '$$ = [$1]'
    o 'for_specs COMMA for_spec' , '$1.push($3); $$ = $1'
  ]
  for_spec: [
    o 'NAME EQ expr COLON expr opt_for_step' , '$$ = yy.node("ForSpec", {name:$1, from:$3, to:$5, step:$6 || yy.node("Number", {value:1})})'
  ]
  opt_for_step: [
    o 'COLON expr' , '$$ = $2'
    o ''           , '$$ = null'
  ]

# -------------------------- lexer --------------------------
# Five modes: INITIAL (line start), CMD, EXPR, PAT (after '?'), WEXPR (after 'WRITE ')
exports.lex =
  macros: {}
  startConditions:
    INITIAL: 0
    CMD: 1
    EXPR: 1
    PAT: 1
    WEXPR: 1
  rules: [
    # Newlines
    ['\\r?\\n+'                                             , 'yy._afterWrite=false; yy.wItemStart=false; yy.inPostcond=false; yy.exprDepth=0; this.begin("INITIAL"); return "NEWLINE";']

    # INITIAL (line start)
    ['<INITIAL>\\.+'                                        , 'yy.depth = yytext.length; return "DOTS";']
    ['<INITIAL>[ \\t]+'                                     , '/* ignore */']
    ['<INITIAL>;[^\\n]*'                                    , 'return "COMMENT";']
    # Label must be followed by two+ spaces or '('
    ['<INITIAL>[A-Za-z%][A-Za-z0-9]*(?=(?:[ \\t]{2,}|\\())' , 'this.begin("CMD"); return "LABEL";']

    # CMD: commands and command‑space switch to EXPR or WEXPR
    ['<CMD>(?:break|b)\\b'                                  , 'return "BREAK";']
    ['<CMD>(?:close|c)\\b'                                  , 'return "CLOSE";']
    ['<CMD>(?:do|d)\\b'                                     , 'return "DO";']
    ['<CMD>(?:else|e)\\b'                                   , 'yy._afterElse=true; return "ELSE";']
    ['<CMD>(?:for|f)\\b'                                    , 'return "FOR";']
    ['<CMD>(?:goto|g)\\b'                                   , 'return "GOTO";']
    ['<CMD>(?:halt|h)\\b'                                   , 'return "HALT";']
    ['<CMD>hang\\b'                                         , 'return "HANG";']
    ['<CMD>(?:if|i)\\b'                                     , 'return "IF";']
    ['<CMD>(?:job|j)\\b'                                    , 'return "JOB";']
    ['<CMD>(?:kill|k)\\b'                                   , 'return "KILL";']
    ['<CMD>(?:lock|l)\\b'                                   , 'return "LOCK";']
    ['<CMD>(?:merge|m)\\b'                                  , 'return "MERGE";']
    ['<CMD>(?:new|n)\\b'                                    , 'return "NEW";']
    ['<CMD>(?:open|o)\\b'                                   , 'return "OPEN";']
    ['<CMD>(?:quit|q)\\b'                                   , 'return "QUIT";']
    ['<CMD>(?:read|r)\\b'                                   , 'return "READ";']
    ['<CMD>(?:set|s)\\b'                                    , 'return "SET";']
    ['<CMD>(?:use|u)\\b'                                    , 'return "USE";']
    ['<CMD>(?:view|v)\\b'                                   , 'return "VIEW";']
    ['<CMD>(?:write|w)\\b'                                  , 'yy._afterWrite = true; return "WRITE";']
    ['<CMD>(?:xecute|x)\\b'                                 , 'return "XECUTE";']
    ['<CMD>tstart\\b'                                       , 'return "TSTART";']
    ['<CMD>tcommit\\b'                                      , 'return "TCOMMIT";']
    ['<CMD>trollback\\b'                                    , 'return "TROLLBACK";']
    ['<CMD>trestart\\b'                                     , 'return "TRESTART";']
    ['<CMD>z[a-z][a-z0-9]*\\b'                              , 'yytext = yytext.toUpperCase(); return "ZCOMMAND";']

    # CMD-level postconditional colon
    ['<CMD>:'                                               , 'yy.inPostcond = true; this.begin("EXPR"); return "COLON";']

    # CMD spaces -> EXPR or WEXPR
    ['<CMD>[ ]+'                                            , 'if (yy._afterWrite) { this.begin("WEXPR"); yy._afterWrite=false; yy.wItemStart=true; yy.exprDepth=0; } else if (yy._afterElse) { yy._afterElse=false; this.begin("CMD"); return "CS"; } else { this.begin("EXPR"); yy.exprDepth=0; } return "CS";']
    ['<CMD>;[^\\n]*'                                        , 'return "COMMENT";']
    ['<CMD>\\r?\\n+'                                        , 'yy._afterWrite=false; yy._afterElse=false; yy.wItemStart=false; yy.inPostcond=false; yy.exprDepth=0; this.begin("INITIAL"); return "NEWLINE";']

    # EXPR spacing/comments; depth-aware; route spaces after postcond to args mode
    ['<EXPR>;[^\\n]*'                                       , 'return "COMMENT";']
    ['<EXPR>[ ]+'                                           , 'if ((yy.exprDepth||0)===0) { if (yy.inPostcond) { if (yy._afterWrite) { this.begin("WEXPR"); yy._afterWrite=false; yy.wItemStart=true; yy.exprDepth=0; yy.inPostcond=false; } else { this.begin("EXPR"); yy.inPostcond=false; yy.exprDepth=0; } return "CS"; } this.begin("CMD"); return "CS"; }']
    ['<EXPR>\\r?\\n+'                                       , 'yy._afterWrite=false; yy._afterElse=false; yy.wItemStart=false; yy.inPostcond=false; yy.exprDepth=0; this.begin("INITIAL"); return "NEWLINE";']

    # punctuation (EXPR) with depth tracking
    ['<EXPR>\\('                                            , 'yy.exprDepth=(yy.exprDepth||0)+1; return "LPAREN";']
    ['<EXPR>\\)'                                            , 'if (yy.exprDepth>0) yy.exprDepth--; return "RPAREN";']
    ['<EXPR>,'                                              , 'return "COMMA";']
    ['<EXPR>:'                                              , 'return "COLON";']
    ['<EXPR>\\^'                                            , 'return "CARET";']
    ['<EXPR>@'                                              , 'return "AT";']
    ['<EXPR>\\|'                                            , 'return "VBAR";']

    # operators (EXPR)
    ['<EXPR>\\+'                                            , 'return "PLUS";']
    ['<EXPR>-'                                              , 'return "MINUS";']
    ['<EXPR>\\*\\*'                                         , 'return "EXP";']
    ['<EXPR>\\*'                                            , 'return "MUL";']
    ['<EXPR>\\\\'                                           , 'return "IDIV";']
    ['<EXPR>#'                                              , 'return "MOD";']
    ['<EXPR>/'                                              , 'return "DIV";']
    ['<EXPR>&'                                              , 'return "AND";']
    ['<EXPR>!'                                              , 'return "OR";']
    ['<EXPR>_'                                              , 'return "CONCAT";']
    ['<EXPR>>='                                             , 'return "GE";']
    ['<EXPR><='                                             , 'return "LE";']
    ['<EXPR>>'                                              , 'return "GT";']
    ['<EXPR><'                                              , 'return "LT";']
    ["<EXPR>'="                                             , 'return "NE";']
    ['<EXPR>='                                              , 'return "EQ";']
    ["<EXPR>'\\["                                           , 'return "NCONTAINS";']
    ['<EXPR>\\['                                            , 'return "CONTAINS";']
    ["<EXPR>\\]'"                                           , 'return "NFOLLOWS";']
    ['<EXPR>\\]'                                            , 'return "FOLLOWS";']
    ["<EXPR>\\]\\]'"                                        , 'return "NSORTAFTER";']
    ['<EXPR>\\]\\]'                                         , 'return "SORTAFTER";']
    ['<EXPR>\\?'                                            , 'yy.patDepth=0; this.begin("PAT"); return "PMATCH";']
    ["<EXPR>'"                                              , 'return "NOT";']

    # atoms (EXPR)
    ['<EXPR>(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?'       , 'return "NUMBER";']
    ['<EXPR>\\"(?:\\"\\"|[^\\"])*\\"'                       , 'return "STRING";']
    ['<EXPR>\\$z[a-z][a-z0-9]*\\b'                          , 'yytext = yytext.slice(2).toUpperCase(); return "ZDOLFN";']
    # DOLSPECVAR (writable subset; device/system gated by options)
    ['<EXPR>\\$(?:X|Y|ECODE|ETRAP|IO|DEVICE|SYSTEM)\\b'     , 'var nm=yytext.slice(1).toUpperCase(); var opts=(yy&&yy.options)||{}; var allow=false; if(nm==="X"||nm==="Y"||nm==="ECODE"||nm==="ETRAP"){allow=true;} else if(nm==="IO"||nm==="DEVICE"){allow=!!opts.allowWritableDeviceVars;} else if(nm==="SYSTEM"){allow=!!opts.allowWritableSystemVar;} yytext=nm; return allow ? "DOLSPECVAR" : "DOLFN";']
    ['<EXPR>\\$[a-z][a-z0-9]*\\b'                           , 'yytext = yytext.slice(1).toUpperCase(); return "DOLFN";']
    ['<EXPR>[A-Za-z%][A-Za-z0-9]*'                          , 'return "NAME";']

    # PAT mode (after '?') — ends on space/comma/newline or on RPAREN when depth==0
    ['<PAT>\\('                                             , 'yy.patDepth=(yy.patDepth||0)+1; return "LPAREN";']
    ['<PAT>\\)'                                             , 'if ((yy.patDepth||0)>0) { yy.patDepth--; return "RPAREN"; } this.begin("EXPR"); return "RPAREN";']
    ['<PAT>,'                                               , 'if ((yy.patDepth||0)>0) return "COMMA"; this.begin("EXPR"); return "COMMA";']
    ['<PAT>[ ]+'                                            , 'if ((yy.patDepth||0)===0) { this.begin("CMD"); return "CS"; }']
    ['<PAT>\\r?\\n+'                                        , 'yy._afterElse=false; this.begin("INITIAL"); return "NEWLINE";']
    ['<PAT>\\d+'                                            , 'return "P_NUM";']
    ['<PAT>\\.'                                             , 'return "P_DOT";']
    ['<PAT>[ACELNPU]'                                       , 'yytext = yytext.toUpperCase(); return "P_CODE";']
    ['<PAT>\\"(?:\\"\\"|[^\\"])*\\"'                        , 'return "STRING";']

    # WEXPR mode (after WRITE CS). Treat adorners specially, otherwise behave like EXPR.
    ['<WEXPR>;[^\\n]*'                                      , 'return "COMMENT";']
    ['<WEXPR>[ ]+'                                          , 'this.begin("CMD"); return "CS";']
    ['<WEXPR>\\r?\\n+'                                      , 'yy._afterWrite=false; yy._afterElse=false; yy.wItemStart=false; yy.inPostcond=false; yy.exprDepth=0; this.begin("INITIAL"); return "NEWLINE";']

    # depth + item tracking
    ['<WEXPR>\\('                                           , 'yy.exprDepth=(yy.exprDepth||0)+1; yy.wItemStart=false; return "LPAREN";']
    ['<WEXPR>\\)'                                           , 'if (yy.exprDepth>0) yy.exprDepth--; return "RPAREN";']
    ['<WEXPR>,'                                             , 'yy.wItemStart=true; return "COMMA";']

    # adorners only at top-level start of an item
    ['<WEXPR>\\*'                                           , 'if ((yy.exprDepth||0)===0 && yy.wItemStart){ yy.wItemStart=false; return "WSTAR"; } return "MUL";']
    ['<WEXPR>\\?'                                           , 'if ((yy.exprDepth||0)===0 && yy.wItemStart){ yy.wItemStart=false; return "WTAB"; } yy.patDepth=0; this.begin("PAT"); return "PMATCH";']
    ['<WEXPR>!'                                             , 'if ((yy.exprDepth||0)===0 && yy.wItemStart){ yy.wItemStart=false; return "WBANG"; } return "OR";']
    ['<WEXPR>#'                                             , 'if ((yy.exprDepth||0)===0 && yy.wItemStart){ yy.wItemStart=false; return "WPOUND"; } return "MOD";']
    ['<WEXPR>/'                                             , 'if ((yy.exprDepth||0)===0 && yy.wItemStart){ yy.wItemStart=false; return "WSLASH"; } return "DIV";']

    # pass-through tokens with wItemStart housekeeping
    ['<WEXPR>:'                                             , 'yy.wItemStart=false; return "COLON";']
    ['<WEXPR>\\^'                                           , 'yy.wItemStart=false; return "CARET";']
    ['<WEXPR>@'                                             , 'yy.wItemStart=false; return "AT";']
    ['<WEXPR>\\|'                                           , 'yy.wItemStart=false; return "VBAR";']

    ['<WEXPR>\\+'                                           , 'yy.wItemStart=false; return "PLUS";']
    ['<WEXPR>-'                                             , 'yy.wItemStart=false; return "MINUS";']
    ['<WEXPR>\\*\\*'                                        , 'yy.wItemStart=false; return "EXP";']
    ['<WEXPR>\\\\'                                          , 'yy.wItemStart=false; return "IDIV";']
    ['<WEXPR>/'                                             , 'yy.wItemStart=false; return "DIV";']
    ['<WEXPR>&'                                             , 'yy.wItemStart=false; return "AND";']
    ['<WEXPR>_'                                             , 'yy.wItemStart=false; return "CONCAT";']
    ['<WEXPR>>='                                            , 'yy.wItemStart=false; return "GE";']
    ['<WEXPR><='                                            , 'yy.wItemStart=false; return "LE";']
    ['<WEXPR>>'                                             , 'yy.wItemStart=false; return "GT";']
    ['<WEXPR><'                                             , 'yy.wItemStart=false; return "LT";']
    ["<WEXPR>'="                                            , 'yy.wItemStart=false; return "NE";']
    ['<WEXPR>='                                             , 'yy.wItemStart=false; return "EQ";']
    ["<WEXPR>'\\["                                          , 'yy.wItemStart=false; return "NCONTAINS";']
    ['<WEXPR>\\['                                           , 'yy.wItemStart=false; return "CONTAINS";']
    ["<WEXPR>\\]'"                                          , 'yy.wItemStart=false; return "NFOLLOWS";']
    ['<WEXPR>\\]'                                           , 'yy.wItemStart=false; return "FOLLOWS";']
    ["<WEXPR>\\]\\]'"                                       , 'yy.wItemStart=false; return "NSORTAFTER";']
    ['<WEXPR>\\]\\]'                                        , 'yy.wItemStart=false; return "SORTAFTER";']
    ["<WEXPR>'"                                             , 'yy.wItemStart=false; return "NOT";']

    ['<WEXPR>(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?'      , 'yy.wItemStart=false; return "NUMBER";']
    ['<WEXPR>\\"(?:\\"\\"|[^\\"])*\\"'                      , 'yy.wItemStart=false; return "STRING";']
    ['<WEXPR>\\$z[a-z][a-z0-9]*\\b'                         , 'yy.wItemStart=false; yytext = yytext.slice(2).toUpperCase(); return "ZDOLFN";']

    # DOLSPECVAR again (device/system gated by options)
    ['<WEXPR>\\$(?:X|Y|ECODE|ETRAP|IO|DEVICE|SYSTEM)\\b'    , 'yy.wItemStart=false; var nm=yytext.slice(1).toUpperCase(); var opts=(yy&&yy.options)||{}; var allow=false; if(nm==="X"||nm==="Y"||nm==="ECODE"||nm==="ETRAP"){allow=true;} else if(nm==="IO"||nm==="DEVICE"){allow=!!opts.allowWritableDeviceVars;} else if(nm==="SYSTEM"){allow=!!opts.allowWritableSystemVar;} yytext=nm; return allow ? "DOLSPECVAR" : "DOLFN";']
    ['<WEXPR>\\$[a-z][a-z0-9]*\\b'                          , 'yy.wItemStart=false; yytext = yytext.slice(1).toUpperCase(); return "DOLFN";']
    ['<WEXPR>[A-Za-z%][A-Za-z0-9]*'                         , 'yy.wItemStart=false; return "NAME";']
  ]

# -------------------------- samples --------------------------

exports.samples = '''

  ;; ---- Invalid MUMPS! ----
  ;SET SET=1  ; label=SET cmd=SET but trailing "=1" is invalid

  ; ---- Labels and formals ----
  START(A,B)
  . WRITE "FORMALS:",A,",",B

  ; ---- Command chaining & postcondition ----
  SET A=1  WRITE "X",!  READ B:5
  :A>0 SET C=2  WRITE "pc ok"

  ; ---- WRITE adorners at WEXPR top-level ----
  WRITE *65, ?5, #, /123

  ; ---- READ with timeouts ----
  READ X:1,Y

  ; ---- NEW with names, indirection, and grouping ----
  NEW A,@B,(C,@(D+1))

  ; ---- KILL with nested groups and indirection ----
  KILL (A,B),^G("x"),@(N)
  KILL (^G("") , ^G("A",""), @("X"))
  KILL @GREF

  ; ---- LOCK with mixed timeouts ----
  LOCK A:1,^G(1),B:Z+1

  ; ---- LOCK incremental/decremental forms (+ / -) ----
  LOCK +^G(1),-^H:5

  ; ---- MERGE simple and multi-target shorthand ----
  MERGE A=B
  MERGE (A,^G(1),@H)=@(S+1)

  ; ---- DO entryrefs (label^routine, routine-only) and argless DO ----
  DO L1^R1(1,2), ^R2
  DO
  . WRITE "after DO"
  . IF 1 WRITE "ok"

  ; ---- IF/ELSE dot-indented block ----
  IF 1
  . WRITE "then"
  ELSE
  . WRITE "else"

  ; ---- ELSE  IF idiom (VistA style) ----
  IF MODE=1  WRITE "mode1"  ELSE  IF MODE=2  WRITE "mode2"  ELSE  WRITE "other"
  IF X  WRITE "t"  ELSE  IF 'X  WRITE "f"

  ; ---- GOTO with multiple targets and postcondition ----
  :X GOTO L1^R, ^R2, L3+2^R3

  ; ---- HALT / BREAK / QUIT / HANG ----
  HALT
  BREAK
  QUIT 1
  HANG 2

  ; ---- OPEN / USE / VIEW / CLOSE device params ----
  OPEN "D":0:1, "E":2
  USE "D":1
  VIEW "A","B"
  CLOSE "D","E"

  ; ---- XECUTE with string and indirection ----
  XECUTE "W \"HI\""
  XECUTE @X

  ; ---- Indirect command execution (@NAME / @(expr)) ----
  @CMD 1,2
  @(F(1)) "A","B"
  DO @ENTRY

  ; ---- Dollar functions and $Z- functions / variables ----
  SET P=$PIECE(S,":",1,3)
  SET Z=$ZDATE(12345)

  ; ---- Indirection on LHS (SET target) ----
  SET @X=1,@(Y+1)=2

  ; ---- SET-only LHS helpers ($PIECE/$EXTRACT assignment) ----
  SET $PIECE(S,":",1,2)=42
  SET $EXTRACT(S,1,2)=42
  SET X=-$PIECE(S,":",1,3)

  ; ---- Pattern matches (class sets, groups, literals) ----
  WRITE X?2AN(1"-")3AL
  IF T?1.2("ok",1U) WRITE "pat"

  ; ---- Pattern classes (extended via parsePattern: D,X,V,Z) ----
  IF S?1D1X1V1Z WRITE "pat-extended"

  ; ---- Negated pattern IF ----
  IF S'?3A.1N  WRITE "bad"

  ; ---- E (Everything) pattern class ----
  IF X?1.E  WRITE "has content"
  IF SSN?3N1"-"2N1"-"4N.E  WRITE "SSN-like"

  ; ---- Comma creates nested IFs (both must be true) ----
  IF A,B WRITE "Both A and B are true"
  IF X=1,Y=2 WRITE "Both X=1 and Y=2"

  ; ---- Boolean operators: ! is OR, & is AND ----
  IF A!B WRITE "A or B is true"
  IF A&B WRITE "A and B are true"
  IF 'A WRITE "Not A"

  ; ---- Numeric literal forms (int, frac, leading-dot, trailing-dot, exponent, unary) ----
  SET N1=123,N2=0,N3=.5,N4=10.,N5=3.14,N6=1E3,N7=5.67E-2,N8=-77,N9=+42,N10=-9E+4
  WRITE N1,N2,N3,N4,N5,N6,N7,N8,N9,N10
  IF +'123'=123  WRITE "num"

  ; ---- ELSE spacing (lint requires two spaces when chaining) ----
  IF 0 WRITE "no"  ELSE  WRITE "else-single"

  ; ---- Longer unique command prefixes (wr/read) ----
  wr "PFX"  re X:1

  ; ---- Extended globals and naked references ----
  SET ^|"ENV"|G(1,2)=3
  ^(1,2)  SET Z=9

  ; ---- Entryref with negative offset ----
  DO L-1^ROUT(5)

  ; ---- FOR headers (single/multi) with optional step ----
  FOR I=1:10
  FOR I=1:1:3,J=0:2:4

  ; ---- JOB variants: entryref + device params ----
  JOB ^RTN:5:"OPT"
  JOB LABEL^RTN(1,2):0:1, ^RTN2:5

  ; ---- Z-commands (vendor) ----
  ZTEST 1,2

  ; ---- READ single character (*X) ----
  READ *CHAR
  READ *KEY:10

  ; ---- READ fixed length (X#n) ----
  READ INPUT#10
  READ CODE#5:30

  ; ---- READ with prompt string ----
  READ "Enter name: ",NAME
  READ "Age: ",AGE:5

  ; ---- Mixed READ variants ----
  READ X,*Y,Z#3,"Password: ",PWD:10

  ; ---- New intrinsic functions ($INCREMENT, $ZTRAP, $ETRAP) ----
  SET CNT=$INCREMENT(^COUNTER)
  SET CNT=$INCREMENT(^COUNTER,5)
  SET TRAP=$ZTRAP
  SET ERR=$ETRAP
  SET $ZTRAP="^ERRORHANDLER"
  SET $ETRAP="DO ^ERROR"

  ; ---- Other VistA intrinsic functions ----
  SET TXT=$TEXT(LABEL)
  SET NXT=$ORDER(^GLOBAL(SUB))
  SET QRY=$QUERY(^GLOBAL(SUB))
  WRITE $TEST,$TLEVEL
  SET REV=$REVERSE("HELLO")
  SET JUST=$JUSTIFY(123,10)

  ; ---- Transactions with arguments ----
  TSTART (X,Y):SERIAL
  TRESTART:$TLEVEL

  ; ---- Command indirection examples ----
  SET CMD="WRITE"  @CMD !,"Hello"
  @("SET") A=1,B=2
  @("KILL") (A,B,C)

  ; ---- Z-commands (VistA/GT.M) ----
  ZWRITE
  ZWRITE X,Y,^GLOBAL
  ZWR X,Y(1,2)
  ZBREAK LABEL^ROUTINE
  ZBREAK LABEL^ROUTINE:"WRITE ""BREAK"""
  ZBREAK -LABEL^ROUTINE
  ZKILL X,Y(1)
  ZSYSTEM "ls -la"
  ZETRAP "^ERROR"
  ZSHOW "V"
  ZLOAD "ROUTINE"
  ZSAVE "ROUTINE"
'''
  .split '\n'
  .map (s) -> s.trim()
  .filter (s) -> s.length
