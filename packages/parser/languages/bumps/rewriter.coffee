# Minimal BUMPS token rewriter (stub)

class BumpsRewriter
  # Accepts token array [[tag, value, loc], ...] and returns rewritten tokens.
  # Adds INDENT/OUTDENT around groups of lines sharing dot-depth.
  rewrite: (tokens) ->
    out = []
    stack = [0] # depth stack, 0 baseline
    i = 0
    while i < tokens.length
      [tag, val, loc] = tokens[i]
      if tag is 'DOTS'
        depth = val.length
        # consume optional CS after DOTS
        j = i + 1
        if tokens[j]?[0] is 'CS' then j++
        # emit indent/outdent relative to prior depth
        prev = stack[stack.length - 1]
        if depth > prev
          out.push ['INDENT', depth, loc]
          stack.push depth
        else if depth < prev
          while stack.length > 0 and stack[stack.length - 1] > depth
            stack.pop()
            out.push ['OUTDENT', depth, loc]
        # skip DOTS (+ optional CS), continue
        i = j
        continue
      if tag is 'NEWLINE'
        out.push [tag, val, loc]
        i++
        continue
      out.push [tag, val, loc]
      i++
    # close any remaining indents before final NEWLINE/$end
    while stack.length > 1
      stack.pop()
      out.push ['OUTDENT', 0, tokens[tokens.length - 1]?[2] or {}]
    out

module.exports = { BumpsRewriter }
