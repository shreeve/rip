# MUMPS Grammar Extensions - Features Missing from Your Current Grammar
# These are additions to integrate with your existing bumps.coffee grammar

# Additional intrinsic functions for your DOLFN token recognition
additional_intrinsic_functions = [
  # Core functions you may be missing
  'ECODE', 'ESTACK', 'ETRAP'           # Error handling
  'HOROLOG'                            # Date/time
  'PRINCIPAL', 'STORAGE', 'TLEVEL'     # System state
  'QLENGTH', 'QSUBSCRIPT'              # Name manipulation
  'FNUMBER'                            # Formatting
  'REFERENCE', 'QUIT'                  # Runtime state
  'KEY', 'X', 'Y'                      # I/O position
]

# Structured System Variable extensions (for your lexer)
ssv_extensions =
  rules: [
    # Add to your EXPR mode lexer rules
    ['<EXPR>\\^\\$SYSTEM\\b', 'return "SSV_SYSTEM";']
    ['<EXPR>\\^\\$JOB\\b', 'return "SSV_JOB";']
    ['<EXPR>\\^\\$GLOBAL\\b', 'return "SSV_GLOBAL";']
    ['<EXPR>\\^\\$LOCK\\b', 'return "SSV_LOCK";']
    ['<EXPR>\\^\\$ROUTINE\\b', 'return "SSV_ROUTINE";']
  ]

# Grammar extensions for your exports.bnf
bnf_extensions =
  # Structured System Variables
  ssv_reference: [
    o 'SSV_SYSTEM LPAREN exprlist RPAREN', '$$ = yy.node("SSV", {name: "$SYSTEM", subs: $3})'
    o 'SSV_JOB LPAREN exprlist RPAREN', '$$ = yy.node("SSV", {name: "$JOB", subs: $3})'
    o 'SSV_GLOBAL LPAREN exprlist RPAREN', '$$ = yy.node("SSV", {name: "$GLOBAL", subs: $3})'
    o 'SSV_LOCK LPAREN exprlist RPAREN', '$$ = yy.node("SSV", {name: "$LOCK", subs: $3})'
    o 'SSV_ROUTINE LPAREN exprlist RPAREN', '$$ = yy.node("SSV", {name: "$ROUTINE", subs: $3})'
  ]

  # Naked references (if not already handled)
  naked_ref: [
    o 'CARET LPAREN exprlist RPAREN', '$$ = yy.node("NakedRef", {subs: $3})'
  ]

  # Extended pattern matching with detailed atoms
  pattern_detailed: [
    o 'pattern_atoms', '$$ = yy.node("PatternDetailed", {atoms: $1})'
  ]

  pattern_atoms: [
    o 'pattern_atom', '$$ = [$1]'
    o 'pattern_atoms pattern_atom', '$1.push($2); $$ = $1'
  ]

  pattern_atom: [
    o 'NUMBER PATTERN_CODE', '$$ = yy.node("PatternAtom", {count: +$1, code: $2})'
    o 'DOT PATTERN_CODE', '$$ = yy.node("PatternAtom", {count: null, code: $2})'
    o 'NUMBER DOT NUMBER PATTERN_CODE', '$$ = yy.node("PatternRange", {min: +$1, max: +$3, code: $4})'
    o 'LPAREN pattern_alternation RPAREN', '$$ = yy.node("PatternGroup", {alts: $2})'
    o 'STRING', '$$ = yy.node("PatternLiteral", {value: $1})'
  ]

  pattern_alternation: [
    o 'pattern_atoms', '$$ = [$1]'
    o 'pattern_alternation COMMA pattern_atoms', '$1.push($3); $$ = $1'
  ]

  # Environment specifications for globals
  global_with_env: [
    o 'CARET LPAREN STRING RPAREN NAME opt_subs', '$$ = yy.node("Var", {global: true, env: $3, name: $5, subs: $6})'
    o 'CARET LPAREN NAME RPAREN NAME opt_subs', '$$ = yy.node("Var", {global: true, env: $3, name: $5, subs: $6})'
  ]

  # Extrinsic function calls ($$FUNC^ROUTINE)
  extrinsic_function: [
    o 'DOLLAR DOLLAR entryref', '$$ = yy.node("ExtrinsicFn", {target: $3})'
  ]

  # WRITE * syntax for ASCII codes
  write_ascii: [
    o 'MUL expr', '$$ = yy.node("WriteASCII", {code: $2})'
  ]

  # Enhanced SET targets for $PIECE, $EXTRACT
  set_special_targets: [
    o 'DOLFN LPAREN expr COMMA expr COMMA expr RPAREN EQ expr',
      'if ($1 === "PIECE") $$ = yy.node("SetPiece", {string: $3, delim: $5, pos: $7, value: $9}); else if ($1 === "EXTRACT") $$ = yy.node("SetExtract", {string: $3, start: $5, end: $7, value: $9});'
    o 'DOLFN LPAREN expr COMMA expr RPAREN EQ expr',
      'if ($1 === "PIECE") $$ = yy.node("SetPiece", {string: $3, delim: $5, pos: null, value: $7}); else if ($1 === "EXTRACT") $$ = yy.node("SetExtract", {string: $3, start: $5, end: null, value: $7});'
  ]

  # Complex post-conditionals with logical operators
  complex_postcond: [
    o 'COLON postcond_expr', '$$ = $2'
  ]

  postcond_expr: [
    o 'postcond_expr AND postcond_expr', '$$ = yy.node("LogicalAnd", {left: $1, right: $3})'
    o 'postcond_expr OR postcond_expr', '$$ = yy.node("LogicalOr", {left: $1, right: $3})'
    o 'expr', '$$ = $1'
  ]

# Additional lexer tokens to add to your exports.tokens
additional_tokens = [
  'SSV_SYSTEM', 'SSV_JOB', 'SSV_GLOBAL', 'SSV_LOCK', 'SSV_ROUTINE'
  'PATTERN_CODE'  # For detailed pattern atoms: A, C, E, L, N, P, U
  'DOT'           # For pattern . syntax
]

# Additional lexer rules for pattern codes
pattern_lexer_rules = [
  ['<EXPR>[0-9]*[ACELMNPU]', 'yytext = yytext.slice(-1); return "PATTERN_CODE";']
  ['<EXPR>\\.', 'return "DOT";']
]

# Integration notes:
# 1. Add additional_tokens to your exports.tokens array
# 2. Add ssv_extensions.rules to your exports.lex.rules array
# 3. Add pattern_lexer_rules to your exports.lex.rules array
# 4. Integrate bnf_extensions rules into your exports.bnf object
# 5. Extend your varref rule to include global_with_env and naked_ref
# 6. Add write_ascii to your write list handling
# 7. Extend your set_item rule to include set_special_targets
# 8. Replace your simple postcond with complex_postcond where appropriate

# Most critical additions:
# - Structured System Variables (^$SYSTEM, ^$JOB, etc.)
# - Detailed pattern matching atoms
# - Environment specifications for globals
# - WRITE * ASCII syntax
# - $PIECE/$EXTRACT as SET targets
# - Complex post-conditional logic (AND/OR in conditions)
