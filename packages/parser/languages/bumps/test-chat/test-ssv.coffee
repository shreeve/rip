# test-ssv.coffee
parser = require("../bumps.coffee")

cases = [
  # $IO gated by allowWritableDeviceVars
  { src: "SET $IO=1",        opts: { allowWritableDeviceVars: false }, label: "$IO with flag OFF (should FAIL)" },
  { src: "SET $IO=1",        opts: { allowWritableDeviceVars: true  }, label: "$IO with flag ON  (should PASS)" },

  # $SYSTEM gated by allowWritableSystemVar
  { src: "SET $SYSTEM=42",   opts: { allowWritableSystemVar: false }, label: "$SYSTEM with flag OFF (should FAIL)" },
  { src: "SET $SYSTEM=42",   opts: { allowWritableSystemVar: true  }, label: "$SYSTEM with flag ON  (should PASS)" },

  # $JOB is always read-only (never writable)
  { src: "SET $JOB=99",      opts: { allowWritableDeviceVars: true, allowWritableSystemVar: true },
    label: "$JOB always read-only (should FAIL)" }
]

for t in cases
  parser.yy = { options: t.opts }
  try
    ast = parser.parse(t.src)
    console.log "#{t.label} → SUCCESS"
    console.log JSON.stringify(ast, null, 2)
  catch err
    console.log "#{t.label} → ERROR: #{err.message}"
