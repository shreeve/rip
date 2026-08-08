# Committed browser-bundle artifacts — AFTER packaging work

Captured: 2026-08-07T20:22:10.434Z
Branch: rip-optimal-packaging
Bun: 1.3.14

| File | bytes | KB |
|------|------:|---:|
| dist/browser/rip.js | 1471490 | 1437.0 |
| dist/browser/rip.min.js | 945714 | 923.5 |
| dist/browser/rip.min.js.br | 155491 | 151.8 |

Round-trip check: recomputed br 155491 bytes; committed br 155491 bytes; match=true

## Delta vs BEFORE (dist/rip.js era)

| Metric | BEFORE | AFTER |
|--------|-------:|------:|
| rip.js raw | 1501.9 KB | 1437.0 KB |
| rip.min.js | (n/a) | 923.5 KB |
| rip.min.js.br | (n/a) | 151.8 KB |
| brotli(unminified rip.js) | 194.2 KB | ~see SIZES.after |
