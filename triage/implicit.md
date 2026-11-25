# Mutation triage: src/implicit.js

Survivors classified: 45 of 191.

## GAP

- src/implicit.js:669:32127:statement — test/rip/objects.rip › a block inside a ternary branch keeps its own colon depth
- src/implicit.js:686:32633:relation — test/rip/objects.rip › a closer before a guard leaves the guard on the statement
- src/implicit.js:686:32630:branch — test/rip/objects.rip › a closer before a guard leaves the guard on the statement
- src/implicit.js:687:32694:number — test/rip/objects.rip › after a dedent a guard binds the next pair, not the statement
- src/implicit.js:687:32691:relation — test/rip/objects.rip › after a dedent a guard binds the next pair, not the statement
- src/implicit.js:689:32770:logic — test/rip/objects.rip › after a dedent a guard binds the next pair, not the statement
- src/implicit.js:689:32757:relation — test/rip/objects.rip › after a dedent a guard binds the next pair, not the statement
- src/implicit.js:689:32748:branch — test/rip/objects.rip › after a dedent a guard binds the next pair, not the statement
- src/implicit.js:689:32796:statement — test/rip/objects.rip › after a dedent a guard binds the next pair, not the statement
- src/implicit.js:689:32781:relation — test/rip/objects.rip › a bracket block keeps the object same-line for its guard
- src/implicit.js:689:32745:statement — test/rip/objects.rip › a bracket block keeps the object same-line for its guard
- src/implicit.js:690:32816:branch — test/rip/objects.rip › after a dedent a guard binds the next pair, not the statement
- src/implicit.js:690:32825:relation — test/rip/objects.rip › after a dedent a guard binds the next pair, not the statement
- src/implicit.js:690:32853:boolean — test/rip/objects.rip › after a dedent a guard binds the next pair, not the statement
- src/implicit.js:690:32813:statement — test/rip/objects.rip › after a dedent a guard binds the next pair, not the statement
- src/implicit.js:725:34409:number — test/rip/objects.rip › a key that opens a call is not line-starting, so its guard is the statement
- src/implicit.js:725:34407:arith — test/rip/objects.rip › a key that opens a call is not line-starting, so its guard is the statement
- src/implicit.js:770:36969:relation — test/rip/objects.rip › a line-starting optional chain closes the object it follows
- src/implicit.js:782:37687:relation — test/rip/objects.rip › a multi-line bracket block keeps the object same-line for its guard
- src/implicit.js:782:37651:statement — test/rip/objects.rip › a multi-line bracket block keeps the object same-line for its guard
- src/implicit.js:787:37841:relation — test/rip/objects.rip › a bodiless class value ends with its line
- src/implicit.js:787:37873:relation — test/rip/objects.rip › a bodiless class value ends with its line
- src/implicit.js:787:37905:relation — test/rip/objects.rip › a bodiless class value ends with its line
- src/implicit.js:801:38592:arith — test/rip/objects.rip › a guard inside a multi-line object binds its own pair
- src/implicit.js:832:40133:number — test/rip/objects.rip › a comma then a newline continues the property list
- src/implicit.js:832:40131:arith — test/rip/objects.rip › a comma then a newline continues the property list
- src/implicit.js:832:40177:number — test/rip/objects.rip › a comma then a newline continues the property list
- src/implicit.js:832:40162:negation — test/rip/objects.rip › a comma then a newline continues the property list
- src/implicit.js:832:40175:arith — test/rip/objects.rip › a comma then a newline continues the property list
- src/implicit.js:836:40366:arith — test/rip/objects.rip › a non-objectish element after a dedented comma ends the object
- src/implicit.js:836:40368:number — test/rip/objects.rip › a trailing comma before a dedent closes the object after the comma
- src/implicit.js:836:40393:number — test/rip/objects.rip › a trailing comma before a dedent closes the object after the comma
- src/implicit.js:837:40457:arith — test/rip/objects.rip › a trailing comma inside an indented array closes the object

## EQUIVALENT

- src/implicit.js:522:25877:number — continuationComma is read only as `=== i - 1` at an INDENT; with 0 that is an INDENT at index 1, where listObjectFrame() is null because no `:` (the only object opener) can precede it
- src/implicit.js:652:31211:statement — falling through after pushing CONTROL: k is a CONTROL_IN_IMPLICIT kind, so only FOR reaches the IMPLICIT_END branch, whose close loop needs an object on top (CONTROL now is) or a TERMINATOR
- src/implicit.js:675:32264:statement — falling through after an opener push: no later branch matches an opener kind (not TERNARY, ':', IMPLICIT_END, '.', or ',')
- src/implicit.js:693:32884:statement — falling through after a closer: no later branch matches a closer kind
- src/implicit.js:727:34469:number — at s = 1, `before` is tokens[0], which the scanner always marks newLine (atLineStart starts true) or is an INDENT, so the `s <= 0` disjunct adds nothing
- src/implicit.js:764:36687:statement — falling through after the `:` handler: ':' matches no later branch
- src/implicit.js:779:37539:statement — a TERNARY still pending at a TERMINATOR at its own depth is already a parse error at that TERMINATOR (strict and tolerant parses both stop there), so later claim state is never read
- src/implicit.js:801:38594:number — tokens[i] is the POST_IF/POST_UNLESS itself, neither opener, closer nor TERMINATOR, so objectContinues(i) reaches the same verdict as objectContinues(i + 1)
- src/implicit.js:805:38661:statement — falling through from the IMPLICIT_END branch: k is never ',' there

## BUG

- src/implicit.js:715:33846:arith — `x = [k]: 1`, `x = "a#{b}": 1`, and `f` + indented `"a#{b}": 1` reject with "Unexpected implicit '{'" at the key, though braced `{[k]: 1}` and `{"a#{b}": 1}` compile; the fallback start this mutant moves is reached only by these forms → expected either the braced meaning or a rejection that names the unsupported key form, got a parser error about a generated token
- src/implicit.js:715:33848:number — same repro as 715:33846 (the mutant only moves where that rejection lands)
- src/implicit.js:787:37887:logic — `x = a: try f()` + newline + `y = 2` → expected `{a: try f()}` then `y = 2`, got "emitter: `a = 1` inside an object literal is a destructuring default" (the TRY CONTROL frame is never retired at the TERMINATOR, so the object swallows the next line); the mutant compiles it correctly. It also flips `x = a: class if c` from `{a: c ? class : undefined}` to `if (c) x = {a: class}` — the latter matches `x = a: [1] if c`

## Notes

- Not a survivor, found while probing: a program whose first token is `:` (`: b`, or `:` + an indented pair) crashes collectObjects with "undefined is not an object (evaluating 'tokens[s].start')" — an unpositioned internal TypeError instead of a positioned rejection.
