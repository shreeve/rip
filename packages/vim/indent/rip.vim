" Vim indent file for Rip
" Language: Rip
" Maintainer: Steve Shreeve

if exists('b:did_indent')
  finish
endif
let b:did_indent = 1

setlocal indentexpr=GetRipIndent()
setlocal indentkeys+=0=else,0=catch,0=finally
setlocal autoindent

let b:undo_indent = 'setlocal indentexpr< indentkeys< autoindent<'

if exists('*GetRipIndent')
  finish
endif

" Patterns that increase indent
let s:increase = '^\s*\%(if\|unless\|else\|for\|while\|until\|loop\|do\|switch\|when\|try\|catch\|finally\|class\|def\|enum\|interface\|component\|render\)\>'

" `component` and `schema` declare through an assignment, so the word that
" opens the block is not the first on its line.
let s:declare  = '=\s*\%(component\|schema\)\>'

" A line-ending arrow opens a body: `->` and `=>` for functions, `~>` for an
" effect, `!>` for a schema's eager-derived field.
let s:arrow    = '[=~!-]>\s*$'

" A `then` with something after it closes its clause on the same line, so the
" block never opens: `if ok then p 1`, `when 1 then p 2`.
let s:inline   = '\<then\>\s*\S'

" Patterns that decrease indent (dedent current line)
let s:decrease = '^\s*\%(else\|catch\|finally\)\>'

function! GetRipIndent() abort
  let lnum = prevnonblank(v:lnum - 1)

  " Start of file
  if lnum == 0
    return 0
  endif

  let prev = getline(lnum)
  let curr = getline(v:lnum)
  let ind  = indent(lnum)
  let sw   = shiftwidth()

  " Previous line increases indent
  if (prev =~# s:increase && prev !~# s:inline) || prev =~# s:declare || prev =~# s:arrow
    let ind += sw
  endif

  " Current line decreases indent
  if curr =~# s:decrease
    let ind -= sw
  endif

  " Don't go negative
  return ind < 0 ? 0 : ind
endfunction
