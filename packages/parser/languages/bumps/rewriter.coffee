# Minimal BUMPS token rewriter (stub)

class BumpsRewriter
  # Accepts token array [[tag, value, loc], ...] and returns possibly rewritten tokens.
  rewrite: (tokens) -> tokens

module.exports = { BumpsRewriter }

