// Operation counter for the deterministic scaling gates
// (RIP_COUNT_OPS). The lexer passes' inner loops carry guarded
// increments (`if (counter.on) counter.n++`); tokenize() re-reads the
// flag on entry, so a test toggles counting per call and reads an EXACT,
// machine-independent iteration count — the COUNT-ratio gates assert
// on it instead of wall time. With the flag off the guards are
// branch-predicted no-ops (measured within timing noise on the
// heaviest tokenize shapes). Counters see instrumented iterations
// only — builtin costs (splice, GC) stay the wall-clock smoke gates'
// territory.
export const counter = { on: false, n: 0 };

export const syncCounterFlag = () => {
  counter.on = typeof process !== 'undefined' && !!process.env.RIP_COUNT_OPS;
  if (counter.on) counter.n = 0;
  return counter.on;
};
