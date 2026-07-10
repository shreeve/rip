// Operation counter for the deterministic scaling gates
// (RIP_COUNT_OPS). The lexer passes' inner loops carry guarded
// increments (`if (ops.on) ops.n++`); tokenize() re-reads the flag on
// entry, so a test toggles counting per call and reads an EXACT,
// machine-independent iteration count — the COUNT-ratio gates assert
// on it instead of wall time. With the flag off the guards are
// branch-predicted no-ops (measured within timing noise on the
// heaviest tokenize shapes). Counters see instrumented iterations
// only — builtin costs (splice, GC) stay the wall-clock smoke gates'
// territory.
export const ops = { on: false, n: 0 };

export const syncOpsFlag = () => {
  ops.on = typeof process !== 'undefined' && !!process.env.RIP_COUNT_OPS;
  if (ops.on) ops.n = 0;
  return ops.on;
};
