# Minimal BUMPS token rewriter (stub)

class BumpsRewriter
  # For now, pass-through tokens; block assembly happens in a post-pass using Line.depth.
  # Accepts token array [[tag, value, loc], ...] and returns tokens unchanged.
  rewrite: (tokens) -> tokens

module.exports = { BumpsRewriter }
