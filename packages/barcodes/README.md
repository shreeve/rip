<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Barcodes

> **QR and Code 128 generator and reader — packed-bitmap QR encoder, camera-budgeted decoder, scan-line Code 128, zero dependencies.**

The encoder keeps a symbol as one `Uint32Array` with 32 modules per word,
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
both axes.

**Runtime:** browser-safe (`rip.browser: true`). One file per symbology,
`qr.rip` and `code128.rip`, each holding its encoder and reader; a root
entry that re-exports both; the camera and canvas plumbing; and the
ISO/IEC 18004 tables, GIF writer and image-input helpers they share.
`rip/barcodes/qr` and `rip/barcodes/code128` import one symbology alone.

## Quick Start

```coffee
import encodeQR, { decodeQR } from 'rip/barcodes'

text = 'Hello world'
console.log encodeQR(text, 'term')            # print to any terminal
svg    = encodeQR text, 'svg'                 # markup for a page
gif    = encodeQR text, 'gif', scale: 4       # Uint8Array, a GIF file
url    = encodeQR text, 'data-url', scale: 4  # 'data:image/gif;base64,...'
matrix = encodeQR text, 'raw'                 # boolean[][] with the quiet zone
ascii  = encodeQR text, 'ascii'               # half-height block characters

# decode any RGBA raster, the shape a canvas ImageData already has
decodeQR { width, height, data }              # the text, or throws

import { encodeCode128, decodeCode128 } from 'rip/barcodes'

encodeCode128 'L2602852147', 'svg', scale: 2  # a Code 128 label
decodeCode128 { width, height, data }         # the text, or throws
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
reserved test form, so output matches python-qrcode module for module.

## Decoding

`decodeQR` takes `{ width, height, data }` and returns the decoded string. It
throws when no symbol decodes; in a camera loop that is a frame miss, feed
the next frame. Clean one-pixel-per-module rasters are too small for
run-length finder detection, so upscale the encoder's `raw` output at least
twice before decoding it.

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
`'12345'` does not pay for a latch it cannot amortize. The outputs are the
QR six with one row of modules: `raw` is a `boolean[]` including the quiet
zone, `ascii` and `term` are one line, and `svg`, `gif` and `data-url` draw
`height` modules of bar.

| option | meaning | default |
| --- | --- | --- |
| `scale` | pixels per module | `1` |
| `border` | quiet-zone modules on each side | `10` |
| `height` | bar height in modules for `svg`, `gif`, `data-url` | `40` |
| `gs1` | open with FNC1 for GS1-128 | `false` |
| `optimize` | one `<path>` instead of one `<rect>` per bar | `true` |

`decodeCode128` takes the same `{ width, height, data }` as `decodeQR`,
with the same `format` option, and returns the text or throws.
`readCode128` returns `null` on a miss and otherwise
`{ text, gs1, codes, line, vertical, reversed, inverted }`: the verified
codewords and which scan line, axis, direction and polarity produced them.
Modules must be at least one pixel wide; a printed label filling a quarter
of a camera frame is plenty.

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
  decoded = camera.readFrame canvas           # undefined until a frame decodes
  if decoded isnt undefined
    console.log decoded
    cancel()
    camera.stop()
```

`QRCanvas` decodes frames through one reusable scanner and paints a finder
overlay, the decoded symbol, or the binarized plane onto the canvases it is
given. `rearCamera` and `selfieCamera` open a stream into a video element;
`camera.listDevices()` and `camera.setDevice(id)` switch cameras. When the
browser exposes `VideoFrame`, frames are copied plane-for-plane into the
scanner arena without a canvas round trip. `svgToPng` and `gifToPng`
rasterize the encoder's output, and `BarcodeDetector` is a Shape Detection
API ponyfill over `decodeQR`. Camera access needs a secure context.

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
at four scales, four rotations, inverted, luma input and GS1-128.
