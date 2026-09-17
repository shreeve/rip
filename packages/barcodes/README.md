<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Barcodes

> **QR, PDF417 and Code 128 generator and reader — packed-bitmap QR encoder, camera-budgeted decoder, ray-voted PDF417, scan-line Code 128, zero dependencies.**

The encoder keeps a symbol as one `Int32Array` with 32 modules per word,
builds the function-pattern template, placement order and the eight mask
planes once per version, and chooses a mask by XORing whole words and
scoring the penalty rules word-parallel. The decoder binarizes a four-level
image pyramid against 8x8 block thresholds, finds finder patterns with
run-length windows that consume a word at a time, projects the best triple
through a homography, and corrects with Reed-Solomon, all inside buffers
allocated once per scanner so a camera frame never allocates. Code 128
lives in one file: the encoder chooses the shortest subset sequence by
dynamic programming, and the reader walks scan lines middle-out, matching
each eleven-module group to its nearest codeword in both directions and on
both axes. PDF417 compacts text, bytes and digits the way the specification
recommends and lays the stream into stacked rows with GF(929) parity; its
reader finds a start or stop pattern on a scan line, tracks both edges up
and down the stack, samples rays across every row along the direction
between them, votes each codeword into the cell its row indicators and
cluster name, and corrects erasures and errors together.

**Runtime:** browser-safe (`rip.browser: true`). One file per symbology,
`qr.rip`, `pdf417.rip` and `code128.rip`, each holding its tables, encoder
and reader; a root entry that re-exports all three; the camera and canvas
plumbing in `dom.rip`; and the GIF writer, ECI table and image-input helpers
the symbologies share. `rip/barcodes/qr`, `rip/barcodes/pdf417` and
`rip/barcodes/code128` import one symbology alone.

**Origin:** the QR encoder, decoder and browser layer are a port of
[paulmillr/qr](https://github.com/paulmillr/qr) by Paul Miller, itself
derived from ZXing, rewritten in Rip with the same algorithms and
byte-identical output on every format. The PDF417 and Code 128 symbologies
are original to this package. See [Credits](#credits).

## Quick Start

```coffee
import encodeQR, { decodeQR } from 'rip/barcodes'

text = 'Hello world'
p encodeQR(text, 'term')                      # print to any terminal
svg    = encodeQR text, 'svg'                 # markup for a page
gif    = encodeQR text, 'gif', scale: 4       # Uint8Array, a GIF file
url    = encodeQR text, 'data-url', scale: 4  # 'data:image/gif;base64,...'
matrix = encodeQR text, 'raw'                 # boolean[][], true is dark, quiet zone included
ascii  = encodeQR text, 'ascii'               # half-height block characters

# decode any RGBA raster, the shape a canvas ImageData already has
decodeQR { width, height, data }              # the text, or throws

import { encodeCode128, decodeCode128 } from 'rip/barcodes'

encodeCode128 'L2602852147', 'svg', scale: 2  # a Code 128 label
decodeCode128 { width, height, data }         # the text, or throws

import { encodePDF417, decodePDF417 } from 'rip/barcodes'

encodePDF417 'Hello PDF417', 'svg', scale: 2  # a stacked symbol
decodePDF417 { width, height, data }          # the text, or throws
```

## Features

- Every version 1..40, every error-correction level, numeric, alphanumeric
  and byte modes, automatic version and mask selection, explicit overrides
- Six outputs: `raw`, `ascii`, `term`, `svg`, `gif`, `data-url`
- Decoding from RGB, RGBA, packed BGRA/X variants, and planar luma formats
  including 10- and 12-bit I420
- ECI-aware byte segments, inverted symbols, arbitrary rotation
- A reusable `QRScanner` for camera loops, with an `effort` tier, a
  `timeLimit` budget, and a cooperative `decodeAsync` that yields between
  bounded work units
- `decodeQRBatch` finds every symbol in each image
- Code 128 with subsets A, B and C, shortest-sequence subset selection,
  GS1-128 FNC1, the same six outputs, and a reader that handles both
  directions, both axes and inverted symbols
- PDF417 with text, byte and numeric compaction, nine error-correction
  levels, 1..30 columns and 3..90 rows, compact symbols, UTF-8 behind an
  ECI, the same six outputs, and a reader that recovers from tilt, skew,
  rotation, inversion, damaged rows, a cropped start pattern and holes,
  and reads Macro PDF417 segment metadata

## Encoding

```coffee
encodeQR text, output, opts
```

| option | meaning | default |
| --- | --- | --- |
| `ecc` | `'low'` 7%, `'medium'` 15%, `'quartile'` 25%, `'high'` 30% | `'medium'` |
| `encoding` | `'numeric'`, `'alphanumeric'`, `'byte'` | smallest fit |
| `version` | 1..40 | smallest fit |
| `mask` | 0..7 | lowest penalty, first on ties |
| `border` | quiet zone in modules, at least 1 | 2 |
| `scale` | pixels per module | 1 |
| `optimize` | `svg` only: merge modules into one path | `true` |
| `textEncoder` | custom text-to-bytes for `byte` mode | UTF-8 |

Single-segment encoding is always used, and penalty scoring runs on the
reserved test form, so output matches the reference implementation module
for module.

## Decoding

`decodeQR` takes `{ width, height, data }` and returns the decoded string. It
throws when no symbol decodes; in a camera loop that is a frame miss, feed
the next frame. A clean raster decodes at one pixel per module.

| option | meaning | default |
| --- | --- | --- |
| `format` | `'RGB'`, `'RGBA'`, `'RGBX'`, `'BGRA'`, `'BGRX'`, `'I420'`, `'I420A'`, `'I422'`, `'I444'`, `'NV12'`, `'I420P10'`, `'I420P12'` | detected from length |
| `effort` | retry tier: 1 runs only the mandatory pass, `Infinity` runs every retry | 1 |
| `timeLimit` | milliseconds available to retries | one 60 FPS frame |
| `textDecoder` | `(bytes, eci) -> string` for byte segments | `TextDecoder` |
| `pointsOnDetect` | `(points, result) ->` finder, alignment and outline geometry | |
| `imageOnResult` | `(image) ->` the sampled module grid as RGBA | |
| `imageOnBitmap` | `(image) ->` each binarized plane before detection | |

For photos and uploads pass `effort: Infinity, timeLimit: Infinity`.
Successful decodes cost the same in every tier; retries only run after a
failed strict pass.

## Code 128

```coffee
import { encodeCode128, decodeCode128, readCode128 } from 'rip/barcodes'

encodeCode128 text, output, opts
```

Every ASCII character encodes; the ASCII group separator (`'\x1d'`) becomes
an FNC1 separator, and `gs1: true` opens the symbol with FNC1 for GS1-128
application identifiers. The codeword sequence is the shortest over the
three subsets, so `'A1234'` latches to subset C for the digit pairs while
`'123'` does not pay for a latch it cannot amortize. The outputs are the
QR six with one row of modules: `raw` is a `boolean[]` with `true` for a bar
and the quiet zone included, `ascii` and `term` are one line, and `svg`, `gif`
and `data-url` draw `height` modules of bar.

| option | meaning | default |
| --- | --- | --- |
| `scale` | pixels per module | `1` |
| `border` | quiet-zone modules on each side, `0` allowed | `10` |
| `height` | bar height in modules for `svg`, `gif`, `data-url` | `40` |
| `gs1` | open with FNC1 for GS1-128 | `false` |
| `optimize` | one `<path>` instead of one `<rect>` per bar | `true` |

`decodeCode128` takes the same `{ width, height, data }` as `decodeQR`,
with the same `format` option, and returns the text or throws
`'Code 128 not found'`. `readCode128 img, format: 'I420'` returns `null` on a
miss and otherwise
`{ text, gs1, codes, line, vertical, reversed, inverted }`: the verified
codewords and which scan line, axis, direction and polarity produced them.
Modules must be at least one pixel wide; a printed label filling a quarter
of a camera frame is plenty.

## PDF417

```coffee
import { encodePDF417, decodePDF417, readPDF417 } from 'rip/barcodes'

encodePDF417 text, output, opts
```

Text is compacted in the four text submodes, six-byte groups in base 900,
or 44-digit groups in base 900, switching where the specification's rules
say a switch pays: a run of thirteen digits, five text characters, or
anything else as bytes. Characters beyond Latin-1 send the whole message as
UTF-8 behind ECI 26. The outputs are the QR six: `raw` is `boolean[][]` with
`true` for a bar, one entry per module and row, quiet zone included;
`ascii`, `term`, `svg`, `gif` and `data-url` draw each row `rowHeight`
modules tall, `ascii` packing two module rows into each line of half-height
block characters.

| option | meaning | default |
| --- | --- | --- |
| `ecc` | error-correction level 0..8, 2 to 512 parity codewords | by message length, as the specification recommends |
| `columns` | data columns 1..30 | the pair nearest `aspect` |
| `rows` | rows 3..90 | the pair nearest `aspect` |
| `aspect` | integer width to height ratio the automatic layout aims for | `3` |
| `rowHeight` | modules per row in every drawn output | `3` |
| `encoding` | `'text'`, `'byte'`, `'numeric'` | `'auto'` |
| `compact` | omit the right row indicator and shorten the stop pattern | `false` |
| `scale` | pixels per module | `1` |
| `border` | quiet zone in modules, `0` allowed | `2` |
| `optimize` | `svg` only: one `<path>` instead of one `<rect>` per bar | `true` |

`decodePDF417` takes the same `{ width, height, data }` as `decodeQR`, with
the same `format` option, and returns the text or throws
`'PDF417 not found'`. `readPDF417` returns `null` on a miss and otherwise

```coffee
{ text, bytes, codewords, columns, rows, ecc, errors, erasures, corners,
  readerInit, macro, vertical, reversed, inverted }
```

`bytes` is the decoded message before text decoding, `codewords` the
corrected stream, `errors` and `erasures` how many cells the parity
repaired, and `corners` the four symbol corners in image space. `macro` is
present for a Macro PDF417 segment:
`{ segmentIndex, fileId, last, segmentCount?, fileName?, timestamp?,
sender?, addressee?, fileSize?, checksum? }`; each segment decodes on its
own and the caller assembles a file from them.

The reader wants modules at least a pixel wide; rows a pixel tall read
from a clean raster, and photographs want a little more. It reads the
symbol in all four orientations and with the tilt and skew of a hand-held
photo, as a mirror image, inverted, with whole rows torn off the top or
bottom, with the start pattern cut off at the image edge, and with holes.
One parity codeword is always held back to check the correction and the
padding after the message must read as pad, so a damaged symbol misses
rather than decoding to the wrong text. The row direction comes from the
start and stop edges tracked together, so a photograph taken from the
side, whose rows stay level while the edges lean, reads as well as a
rotated one. Against ZXing's PDF417 blackbox photo sets 1 to 3 it decodes
all 58 images at each of four rotations. Its Macro set decodes one segment
per image; images holding several symbols return the first found.

## Scanner

```coffee
import { QRScanner } from 'rip/barcodes'

scanner = QRScanner.new maxSize: { width: 1920, height: 1080 }, effort: 2
scanner.addImage frame           # any supported format, up to maxSize
results = scanner.decode()       # [string] or [Error]
results = scanner.decodeAsync!   # same, yielding to the host between chunks
scanner.clean()                  # zero every buffer when the source is released
```

One scanner serves a whole camera session: its luma arena, pyramid, threshold
grids, bitmaps and finder tables are allocated in the constructor and reused
for every frame. Operations are exclusive; a call made while `decodeAsync`
is pending throws.

## Camera

```coffee
import { QRCanvas, frameLoop, rearCamera } from 'rip/barcodes/dom'

video = document.querySelector 'video'
overlay = document.querySelector 'canvas'     # positioned over the video
canvas = QRCanvas.new { overlay }
camera = rearCamera! video
cancel = frameLoop ->
  decoded = camera.readFrame! canvas          # undefined until a frame decodes
  if decoded isnt undefined
    p decoded
    cancel()
    camera.stop()
```

`QRCanvas` decodes frames through one reusable scanner and paints a finder
overlay, the decoded symbol, or the binarized plane onto the canvases it is
given. `rearCamera` and `selfieCamera` open a stream into a video element,
asking for the sensor's full size (3840x2160 ideal at 30 frames per
second, with `opts.video` layering further constraints), since a symbol's
modules must reach a pixel or two in the frame the readers see; the
browsers' default of the screen size gives a driver's license no distance
at which it both focuses and resolves. `camera.settings()` reports what
the track delivered and `camera.capabilities()` what it can change;
`camera.zoom! 2` crops the sensor for twice the pixels per module,
`camera.torch! true` lights the scene, `camera.apply! { focusMode:
'continuous' }` sets any other advanced constraint the browser offers
(iOS exposes zoom and torch, Android also focus and exposure), and
`camera.reopen! { width: { ideal: 1920 } }` restarts the stream under new
constraints. `camera.listDevices()` and `camera.setDevice(id)` switch
cameras. When the browser exposes `VideoFrame`,
`camera.readFrame! canvas, true` copies frames plane-for-plane into the
scanner arena without a canvas round trip, and `canvas.lastFrame()` hands
that luma to the other readers as `format: 'I420'` without another copy.
`svgToPng` resolves to a PNG data URL and `gifToPng` to a `Blob`, and
`BarcodeDetector` is a Shape Detection API ponyfill over `decodeQR` and
`readPDF417` that reports `qr_code` and `pdf417`. Camera access needs a
secure context.

## Performance

Measured against [paulmillr/qr](https://github.com/paulmillr/qr) 0.7.0, the
TypeScript implementation this package was ported from, both running under
Bun 1.4.0 on an Apple M5. Each figure is the best of three processes; every
process runs the whole sequence in this order, so each row is timed after
the rows above it warmed the JIT, the way an application mixes symbol sizes.

| Encode (µs)         |   rip | paulmillr/qr | speedup |
|---------------------|------:|-------------:|--------:|
| raw, version 1      |   2.4 |          3.2 |   1.33x |
| raw, version 8      |  14.7 |         24.7 |   1.68x |
| raw, version 18     |  46.4 |         61.8 |   1.33x |
| svg, version 8      |  31.0 |         47.4 |   1.53x |
| gif, version 8      |  14.6 |         18.3 |   1.25x |

| Decode (µs)                |    rip | paulmillr/qr | speedup |
|----------------------------|-------:|-------------:|--------:|
| 132x132 raster, version 1  |   28.5 |        114.1 |   4.00x |
| 1280x720 frame, one symbol |    578 |         1010 |   1.75x |
| 1920x1080 frame, one symbol|   1300 |         2210 |   1.70x |
| 1920x1080 noise, no symbol |   6030 |        23900 |   3.96x |

Encode inputs are `Hello world`, 192 bytes and 768 bytes of text. Decode
inputs are synthetic RGBA frames with one symbol centered on a flat
background, plus a full-frame noise image for the miss case, which is
dominated by the finder search; this package walks it on packed words.

PDF417 has no reference implementation in the same runtime to race, so
its figures stand alone, measured the same way on the same machine:

| PDF417 encode (µs)          |   rip |
|-----------------------------|------:|
| raw, `Hello PDF417`         |  10.4 |
| raw, 192 bytes of text      |  39.5 |
| raw, 768 bytes of text      | 135.7 |
| raw, 200 digits             |  39.4 |
| svg, 192 bytes              |  26.0 |
| gif, 192 bytes              |  25.3 |

| PDF417 decode (µs)               |   rip |
|----------------------------------|------:|
| 300x100 raster, 9 rows x 2 cols  |    83 |
| 1280x720 frame, one symbol       |   232 |
| 1920x1080 frame, 192 bytes       |   343 |
| 1920x1080 noise, no symbol       |   302 |

The frames are the same kind as the QR rows above, with the symbol drawn
at two to four pixels per module. Photographs from ZXing's corpus decode
in 0.4 to 8 ms, the largest a 2390x2220 image of 74 rows by 12 columns at
level 8.

Encode timings are sensitive to which symbol size a process sees first.
A version 1 symbol fits one 32-bit word per row and never fills a word, so
a JIT that meets it first specializes the encoder on small integers; the
first larger symbol then produces full words, which JavaScript reads as
doubles from an unsigned array, and the recompiled mixed-type code runs
slower for the rest of the process. The reference implementation shows
this in the table: warmed only on its own size, its raw version 8 and
18 rows are 16.8 and 52.8. This package stores matrix words in an
`Int32Array`, so a full word is an ordinary integer in every version and
the encoder keeps one specialization whatever order the sizes arrive in.

A personal note from the author of this port: Paul Miller, who wrote the
reference implementation, is a friend of mine and wickedly smart. Coming
even close to what he built took invoking the greatest AI frontier model
in the world, and a great deal of measuring.

## Credits

The QR half of this package is a port of [paulmillr/qr](https://github.com/paulmillr/qr)
0.7.0 by [Paul Miller](https://paulmillr.com), released under MIT OR
Apache-2.0 and derived in turn from the ZXing project. The QR tables,
encoder, decoder pipeline, scanner, camera plumbing and `BarcodeDetector`
ponyfill follow his design; the port keeps his algorithms, restructures
them for Rip, and verifies itself against his implementation with an
oracle that compares every output format byte for byte and every decode
result on synthetic frames. The performance work described above is on top
of that foundation. Code 128 and PDF417 are original to this package and
share only the image input, ECI table and GIF writer. The PDF417 encoder
is checked against [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp),
which decodes its output byte for byte across compaction modes, levels,
shapes and scales, and the reader against the photographs in ZXing's
PDF417 blackbox corpus.

## Test

```bash
bun run test
```

The suite pins spec tables, encoded codewords, every output format, every
version and every mask against vectors generated from the reference
implementation, then round-trips synthetic rasters through the decoder
across versions, levels, rotations, inverted symbols, input formats, batch
decoding and scanner reuse. Code 128 is pinned against the published
`Wikipedia` vector, shortest-subset choices, every output, and round trips
at four scales, four rotations, inverted, luma input and GS1-128. PDF417
pins codeword streams for every compaction mode, the GF(929) generator and
parity, symbol layout and row indicators, a full module matrix, every
output, errors-and-erasures correction to its limit, and decompaction
including Macro PDF417, then round-trips rasters across scales, row
heights, rotations, inversion, compact and extreme shapes, skew, cropped
and torn start columns and holes.
