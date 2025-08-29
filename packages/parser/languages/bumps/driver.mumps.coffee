
### driver.mumps.coffee
# Tiny driver to exercise the grammar with key test cases.
# Usage (after you build the parser with your existing build step):
#   bun run driver.mumps.coffee    (or)    node driver.mumps.coffee
#
# NOTE: This driver expects you to expose a function `parse` from the compiled grammar module.
# If your build exports differently, adjust the require/import below.

try
  parser = require('./parser')  # adjust if your build path differs
catch err
  console.error "Cannot require('./parser'). Build your Jison parser first. Error:", err?.message
  process.exit 1

samples = [
  # Argless DO + dot block
  "DO\n. WRITE \"hi\"\n. IF 1 WRITE \"ok\"",
  # IF/ELSE ladder
  "IF A WRITE \"A\"  ELSE  IF B WRITE \"B\"  ELSE  WRITE \"C\"",
  # Indirection
  "SET @(\"A(\"_I_\")\")=1\nKILL @GREF\nDO @ENTRY\nXECUTE \"WRITE \"\"ok\"\"\"",
  # Extended refs + naked refs
  "SET X=^|\"NS\"|G(1)\n^(\"a\",\"b\")  SET Y=1",
  # Unary with intrinsics
  "SET X=-$PIECE(S,\":\",1,3)\nIF +'123'=123  WRITE \"num\"",
  # WRITE adornments
  "WRITE ?10,\"hi\",!,\"bye\",#,*65,\"_\",1,']'B,\"]\"A",
  # Pattern richness
  "IF S?3A.1N  WRITE \"ok\"\nIF S?2(\"ab\")  WRITE \"ok\"\nIF S?1.3(\"x\",1U)  WRITE \"ok\"",
  # Transactions
  "TSTART  SET X=1  TCOMMIT"
]

ok = 0
for s, idx in samples
  try
    ast = parser.parse s
    console.log "\\n--- SAMPLE #{idx+1} OK ---\\n", s
    console.log JSON.stringify(ast, null, 2)[0..400] + "..."
    ok++
  catch e
    console.error "\\n--- SAMPLE #{idx+1} FAILED ---\\n", s
    console.error e?.message

console.log "\\nPassed #{ok}/#{samples.length} samples"
