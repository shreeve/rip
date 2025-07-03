/* Calculator Grammar for Jison */

/* lexical grammar */
%lex

%%
\s+                   /* skip whitespace */
[0-9]+("."[0-9]+)?\b  return 'NUMBER'
"*"                   return '*'
"/"                   return '/'
"-"                   return '-'
"+"                   return '+'
"("                   return '('
")"                   return ')'
<<EOF>>               return 'EOF'
.                     return 'INVALID'

/lex

/* operator associations and precedence */
%left '+' '-'
%left '*' '/'
%right UMINUS

%start expressions

/* language grammar */
%%

expressions
    : e EOF
        { return $1; }
    ;

e
    : e '+' e
        { $$ = $1 + $3; }
    | e '-' e
        { $$ = $1 - $3; }
    | e '*' e
        { $$ = $1 * $3; }
    | e '/' e
        { $$ = $1 / $3; }
    | '(' e ')'
        { $$ = $2; }
    | '-' e %prec UMINUS
        { $$ = -$2; }
    | NUMBER
        { $$ = Number($1); }
    ;