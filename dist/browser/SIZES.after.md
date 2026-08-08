# Browser / src size baseline — AFTER

Captured: 2026-08-07T20:22:10.382Z
Branch: rip-optimal-packaging
HEAD: 8d81661
Bun: 1.3.14

Policy: **source keeps comments.** The `.min.js` ship artifact uses standard minify
(comments stripped there only). That is a transfer optimization, not a source style change.

All sizes in KB. `br*` = brotli quality 11.

| File | raw | nocom | min | br(raw) | br(nocom) | br(min) | cmt% |
|------|----:|------:|----:|--------:|----------:|--------:|-----:|
| dist/rip.js | 1437.0 | 1435.8 | 928.6 | 182.9 | 182.6 | 152.2 | 0% |
| emitter.js | 706.4 | 519.5 | 255.4 | 155.1 | 97.9 | 56.9 | 26% |
| parser.js | 425.9 | 425.9 | 405.4 | 24.3 | 24.2 | 23.5 | 0% |
| lexer.js | 215.2 | 119.8 | 60.1 | 53.4 | 22.0 | 16.7 | 44% |
| schema.js | 85.0 | 63.6 | 38.7 | 21.6 | 14.3 | 11.9 | 25% |
| runtime/schema.js | 71.0 | 58.5 | 35.0 | 15.0 | 10.6 | 8.8 | 18% |
| runtime/components.js | 50.2 | 35.4 | 21.1 | 12.5 | 7.5 | 6.0 | 30% |
| runtime/schema-orm.js | 104.2 | 79.5 | 47.3 | 24.5 | 16.4 | 12.9 | 24% |
| runtime/reactive.js | 22.2 | 11.3 | 5.4 | 6.1 | 2.4 | 1.7 | 49% |
| schema-types.js | 39.4 | 22.0 | 14.4 | 10.8 | 4.9 | 4.1 | 44% |
| component-types.js | 33.1 | 16.8 | 10.5 | 9.9 | 4.2 | 3.3 | 49% |
| dts.js | 29.6 | 17.9 | 9.3 | 7.9 | 3.9 | 3.1 | 39% |
| typetext.js | 21.7 | 11.9 | 7.1 | 6.6 | 3.1 | 2.5 | 45% |
| render.js | 21.7 | 14.5 | 7.6 | 5.7 | 3.1 | 2.3 | 33% |
| compile.js | 19.0 | 6.8 | 4.0 | 6.2 | 1.9 | 1.6 | 64% |
| builder.js | 17.2 | 7.1 | 4.2 | 5.3 | 1.7 | 1.4 | 59% |
| stores.js | 13.3 | 6.4 | 3.8 | 4.1 | 1.6 | 1.3 | 52% |
| browser-boot.js | 12.8 | 12.0 | 6.7 | 3.6 | 3.2 | 2.6 | 6% |
| browser.js | 1.6 | 0.9 | 0.7 | 0.6 | 0.3 | 0.3 | 48% |
| browser-modules.js | 11.2 | 8.1 | 4.5 | 3.5 | 2.4 | 1.8 | 27% |
| browser-scripts.js | 7.1 | 5.1 | 2.9 | 2.4 | 1.6 | 1.3 | 28% |
| browser-runtimes.js | 0.6 | 0.4 | 0.3 | 0.2 | 0.1 | 0.1 | 34% |
| repl.js | 46.1 | 33.0 | 22.1 | 13.5 | 8.8 | 7.4 | 29% |
| migrate.js | 50.4 | 38.5 | 23.0 | 13.0 | 9.2 | 7.0 | 23% |
| check.js | 42.1 | 26.1 | 15.3 | 12.2 | 6.6 | 5.4 | 38% |
| runtime/stdlib.js | 5.2 | 3.7 | 2.6 | 1.8 | 1.2 | 1.0 | 29% |
| dom-vocab.js | 12.1 | 9.4 | 7.9 | 3.8 | 2.8 | 2.6 | 22% |

## Notes

- `dist/rip.js` is the committed unminified browser bundle.
- Per-file `min` is Bun.Transpiler minify on that file alone.
- `runtime/schema-orm.js` is CLI/server weight; it must stay out of the browser graph.
- Full-graph `rip.min.js` / `.br` sizes are recorded after the bundle script emits them.
