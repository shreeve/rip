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
let s:increase = '^\s*\%(if\|unless\|for\|while\|until\|loop\|do\|switch\|when\|try\|catch\|finally\|class\|def\|enum\|interface\|component\|render\)\>'

" `else` opens a block only bare or as `else if` / `else unless`. With any
" other content after it the body is inline (`else p 1`), or the line is a
" connector: `then` / `else` also read as loose `and` / `or` below
" assignment (`x = get() else fallback()`), and a connector may open the
" next line (`else fallback()` under `y = get()`). Neither opens a block.
let s:elseOpens = '^\s*else\s*\%($\|\%(if\|unless\)\>\)'

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

" A tail keeps the level of an inline conditional right above it:
" `if x then a` / `else b`, `when 1 then a` / `else b`.
let s:inlineCond = '^\s*\%(if\|unless\|when\|else\)\>.*\<then\>\s*\S'

" The line a tail word dedents to: the nearest shallower line, when it is
" the construct that owns the tail. A plain `else` never owns a later
" `else`; `else if` / `else unless` do. When no owner is found the tail
" is a connector line and keeps the level it continues.
let s:owner = {
      \ 'else':    '^\s*\%(if\|unless\|when\|else\s\+\%(if\|unless\)\)\>',
      \ 'catch':   '^\s*\%(try\|catch\)\>',
      \ 'finally': '^\s*\%(try\|catch\)\>',
      \ }

" The nearest previous non-blank line shallower than `lnum`, as a line
" number, or 0 when there is none or it is not the owner asked for.
function! s:OwnerLine(lnum, pat) abort
  let base = indent(a:lnum)
  let l = prevnonblank(a:lnum - 1)
  while l > 0
    if indent(l) < base
      return getline(l) =~# a:pat ? l : 0
    endif
    let l = prevnonblank(l - 1)
  endwhile
  return 0
endfunction

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
  if ((prev =~# s:increase || prev =~# s:elseOpens) && prev !~# s:inline) || prev =~# s:declare || prev =~# s:arrow
    let ind += sw
  endif

  " Current line is a tail: it sits at its owner's level, or stays where
  " the previous line is when that line is an inline conditional or when
  " nothing shallower owns it (a connector continuation).
  if curr =~# s:decrease
    if prev =~# s:inlineCond
      let ind = indent(lnum)
    else
      let word  = matchstr(curr, '^\s*\zs\%(else\|catch\|finally\)')
      let owner = s:OwnerLine(lnum, s:owner[word])
      let ind   = owner > 0 ? indent(owner) : indent(lnum)
    endif
  endif

  " Don't go negative
  return ind < 0 ? 0 : ind
endfunction
