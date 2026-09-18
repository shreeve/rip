<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Barcodes

> **Generate and read QR, PDF417 and Code 128 barcodes, in the browser or on the server, with no dependencies.**

Rip Barcodes is a barcode library written in [Rip](https://github.com/shreeve/rip).
It makes barcodes and it reads them back, from a still image or from a live
camera, fast enough to scan on a phone at thirty frames a second.

**What it does**

- **Generates** QR codes, PDF417 stacks and Code 128 labels as SVG, GIF,
  a data URL, a module matrix, ASCII art, or straight to the terminal.
- **Reads** all three from any raster: a canvas `ImageData`, an RGB or RGBA
  buffer, or the planar YUV frames a camera delivers.
- **Scans** from a phone's camera through a small browser layer that opens
  the stream at full sensor size, copies frames into the reader without
  a canvas round trip, and draws a lock around what it finds.

**Why you might want it**

- **It reads photographs well.** On ZXing's own test photographs it reads
  more symbols than ZXing's tests require, in every set, with no false
  reads: 684 QR against 611, 96 Code 128 against 90, and every PDF417.
  Code 128 reads at any angle; PDF417 reads a driver's license at arm's
  length.
- **It is fast.** A 1080p frame with no symbol in it costs a few
  milliseconds for QR and under two for the linear and stacked readers, so
  a camera loop never falls behind. It reads QR 1.5 to 4x faster than
  the TypeScript library it was ported from.
- **It is small and self-contained.** Plain code, no WebAssembly, no native
  module, nothing to install beyond the package. One import gives you all
  three symbologies; `rip/barcodes/qr`, `rip/barcodes/pdf417` and
  `rip/barcodes/code128` give you one.
- **It is measured.** The test suite, a scorecard against ZXing's corpus,
  and a timing benchmark live in the package, and every number in this
  README comes from them.

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

## QR

### Encoding

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

### Decoding

`decodeQR` takes `{ width, height, data }` and returns the decoded string. It
throws when no symbol decodes; in a camera loop that is a frame miss, feed
the next frame. A clean raster decodes at one pixel per module.

| option | meaning | default |
| --- | --- | --- |
| `format` | `'RGB'`, `'RGBA'`, `'RGBX'`, `'BGRA'`, `'BGRX'`, `'I420'`, `'I420A'`, `'I422'`, `'I444'`, `'NV12'`, `'I420P10'`, `'I420P12'` | detected from length |
| `effort` | retry tier: 1 runs only the mandatory pass, `Infinity` runs every retry | 1 |
| `timeLimit` | milliseconds available to retries | one 60 FPS frame |
| `nativeLimit` | shorter side above which finder search skips the native layer and starts at half resolution; modules are still read from native luma | `Infinity` |
| `textDecoder` | `(bytes, eci) -> string` for byte segments | `TextDecoder` |
| `pointsOnDetect` | `(points, result) ->` finder, alignment and outline geometry | |
| `imageOnResult` | `(image) ->` the sampled module grid as RGBA | |
| `imageOnBitmap` | `(image) ->` each binarized plane before detection | |

For photos and uploads pass `effort: Infinity, timeLimit: Infinity`.
Successful decodes cost the same in every tier; retries only run after a
failed strict pass.

### Scanner

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

## Code 128

```coffee
import { encodeCode128, decodeCode128, readCode128 } from 'rip/barcodes'

encodeCode128 text, output, opts
```

Every ASCII character encodes; the ASCII group separator (`'\x1d'`) becomes
an FNC1 separator, and `gs1: true` opens the symbol with FNC1 for GS1-128
application identifiers. A separator in first position is that opening
FNC1, so `'\x1dAB'` reads back as `'AB'` with `gs1` set. The codeword sequence is the shortest over the
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
`'Code 128 not found'`. `readCode128` returns `null` on a miss and otherwise

```coffee
{ text, gs1, codes, angle, o, t0, t1, corners, vertical, reversed, inverted }
```

`gs1` is whether the symbol opened with FNC1 and `codes` the verified
codewords. The scan line that read them is `angle` (0 along rows, a
quarter turn along columns, anything between along a tilt) and `o`, its
signed distance from the image center along the normal, and the symbol
spans `t0` to `t1` along it, in pixels from the line's foot at the
center. `vertical`, `reversed` and `inverted` are the axis, direction and
polarity of the read, and `corners` the four corners in image space, fit
to the lines that read the same codewords along the bars' own direction,
so a tilted label gives a tilted quad of its full height.

Lines run along both axes; a tilted label crosses an
axis line with enough runs for a symbol yet does not read, and its tilt
shows as a shift of the bar pattern between that line and one six lines
over, so the reader correlates the two, reads along the estimated
direction through the crossing, and so reads a label at any angle for a
fraction of a millisecond more per frame. A label leaning a little still
reads on an axis line; its lean is measured the same way from that line
and the corners tracked along it, since across a wide label few axis
lines read and a fit through them alone cannot tell the lean. `tilt:
false` reads the axes only. Modules must be at least one pixel wide; a
printed label filling a quarter of a camera frame is plenty.

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

## Camera

```coffee
import { QRCanvas, frameLoop, rearCamera } from 'rip/barcodes/dom'

video = document.querySelector 'video'
overlay = document.querySelector 'canvas'     # positioned over the video
canvas = QRCanvas.new { overlay }
camera = rearCamera! video
cancel = frameLoop (->
  decoded = camera.readFrame! canvas, true    # undefined until a frame decodes
  if decoded isnt undefined
    p decoded
    cancel()
    camera.stop()
), video                                      # paced by the video's presented frames
```

`QRCanvas.new elements, opts` decodes frames through one reusable scanner.
`elements` names the canvases it paints: `overlay` for the lock around a
decoded symbol, `resultQR` for the sampled module grid (scaled by
`resultBlockSize`, 8), `bitmap` for the binarized plane of each frame.

| option | meaning | default |
| --- | --- | --- |
| `crop` | aspect (width over height) of the largest centered region scanned; `null` scans the whole frame | `1` |
| `margin` | fraction of that region scanned beyond each edge, where the frame has pixels | `0` |
| `async` | decode with `decodeAsync`, yielding to the host between chunks | `false` |
| `decodeAll` | decode every symbol on the frame and draw every lock | `false` |
| `effort`, `timeLimit`, `nativeLimit`, `textDecoder` | passed to the scanner (see [Decoding](#decoding)) | |
| `nativeEvery` | with `nativeLimit`: the frame interval at which the native layer is searched regardless | `1` |
| `overlayColor`, `overlayFailedColor` | the lock, and the lock with `drawFailed` on a symbol found but not read | green, red |
| `overlaySideColor` | dims the frame outside the scanned region | `black` |
| `overlayEase` | of the way to a lock's new corners per display frame; `1` snaps | `0.3` |
| `overlayTimeout` | milliseconds a lock outlives its last sighting before fading | `500` |
| `drawFailed` | draw a lock on a symbol that was found but did not decode | `false` |
| `onVideoFrame` | `(frame) ->` the first `VideoFrame` of each source, borrowed: it is closed after the call | |
| `onFrameSource` | `(source) ->` `'VideoFrame'` or `'canvas'` when the frame path changes | |

`canvas.cropTo! aspect, margin` changes the scanned region from the next
frame on, so a page scans what its viewfinder shows plus a little past its
edges, and the copy out of the video frame stays that small.
`canvas.lastFrame()` hands the luma of the last decoded frame to the other
readers as `format: 'I420'` without another copy; it is `null` before the
first frame and while the next copy is landing. `canvas.mark! corners`
draws the lock on four image-space corners another reader found on that
frame, such as a PDF417 hit's `corners`. `canvas.clear!` stops the decode
in flight, zeroes the scanner and clears every canvas.

`rearCamera` and `selfieCamera` open a stream into a video element,
asking for the sensor's full size (3840x2160 ideal at 30 frames per
second, with `opts.video` layering further constraints), since a symbol's
modules must reach a pixel or two in the frame the readers see; the
browsers' default of the screen size gives a driver's license no distance
at which it both focuses and resolves. `camera.readFrame! canvas, true`
copies the presented frame plane-for-plane into the scanner arena through
`VideoFrame` where the browser has it, falling back to a canvas draw;
without `true` it draws the player at its rendered size, which is only
for a page whose overlay must live in CSS pixels. `opts.format` is
`'auto'` (the native planes), `'canvas'` (never `VideoFrame`) or one
`VideoFrame` pixel format to convert to; `camera.setFormat format`
changes it. `camera.settings()` reports what the track delivered and
`camera.capabilities()` what it can change; `camera.zoom! 2` crops the
sensor for twice the pixels per module, `camera.torch! true` lights the
scene, `camera.apply! { focusMode: 'continuous' }` sets any other
advanced constraint the browser offers (iOS exposes zoom and torch,
Android also focus and exposure), and `camera.reopen! { width: { ideal:
1920 } }` restarts the stream under new constraints. `camera.listDevices!`
and `camera.setDevice! id` switch cameras; `camera.stop()` releases the
camera. `getSize element` is an element's rendered size in CSS pixels.
`svgToPng` resolves to a PNG data URL and `gifToPng` to a `Blob`, and
`BarcodeDetector` is a Shape Detection API ponyfill over `decodeQR` and
`readPDF417` that reports `qr_code` and `pdf417`. Camera access needs a
secure context.

## Performance

Everything below is reproducible from this directory on an Apple M5 under
Bun 1.4.0. `rip test/bench.rip` is the package's timing contract: every
figure a mean over a 400 ms window after warm-up, the readers on a clean
raster and on frames with no symbol at 1080p and at the 2160x2592 arena a
phone's square viewfinder scans, as I420 luma. A change to a reader lands
with the rows it touches.

| Encode                    |       |
|---------------------------|------:|
| QR raw, version 1         |  2 µs |
| QR raw, version 10        | 15 µs |
| QR raw, version 22        | 47 µs |
| QR svg, version 10        | 32 µs |
| QR gif, version 10        | 15 µs |
| Code 128 raw, 18 chars    |  2 µs |
| PDF417 raw, 18 chars      | 12 µs |

| Read a clean raster       |         |
|---------------------------|--------:|
| QR version 1, 132x132     |   36 µs |
| QR 1280x720               |  653 µs |
| QR version 10, 1920x1080  | 1.56 ms |
| Code 128, 1920x1080       |  171 µs |
| PDF417, 1920x1080         |  149 µs |

| Miss, no symbol   | 1920x1080 | 2160x2592 |
|-------------------|----------:|----------:|
| QR, desk          |   5.01 ms |  13.59 ms |
| QR, printed page  |   2.83 ms |   8.21 ms |
| QR, noise         |  10.78 ms |  27.54 ms |
| QR, fine weave    |   3.60 ms |  10.44 ms |
| QR, desk, `nativeLimit: 1500` |   |   4.70 ms |
| Code 128, desk    |   1.04 ms |   1.43 ms |
| Code 128, printed page |      |   927 µs |
| Code 128, noise   |           |   2.20 ms |
| PDF417, desk      |    288 µs |    464 µs |
| PDF417, noise     |           |   1.31 ms |

A camera runs the miss rows thirty times a second, so they are what
sets the frame budget; the phone is about twice as slow as this machine.
Photographs from ZXing's corpus decode in a fraction of a millisecond to
11 ms, the slowest a 2390x2220 PDF417 of 74 rows by 12 columns at level 8.

`rip test/corpus.rip` scores the readers on ZXing's blackbox photographs
against the counts ZXing's own tests require; `test/corpus.txt` is that
output, committed:

| Set                          | images | rip reads | ZXing requires |
|------------------------------|-------:|----------:|---------------:|
| qrcode-1 to 6, four rotations |   179 |       684 |            611 |
| pdf417-1 to 3, where tested   |    58 |       144 |            144 |
| code128-1 to 3, where tested  |    49 |        96 |             90 |
| falsepositives-1 and 2        |    47 |   0 false |    up to 6 allowed |

`rip test/compare.rip` races the QR half against
[paulmillr/qr](https://github.com/paulmillr/qr) 0.7.0, the TypeScript
implementation it was ported from, with Paul's package checked out at
`misc/qr`. Both run in one process on the same inputs; each row is the
best of three 400 ms means, this package timed first:

| Encode (µs)                 |    rip | paulmillr/qr | speedup |
|-----------------------------|-------:|-------------:|--------:|
| raw, version 1              |    2.3 |          3.0 |   1.33x |
| raw, version 10             |   14.1 |         16.8 |   1.19x |
| raw, version 22             |   45.5 |         51.2 |   1.13x |
| svg, version 10             |   29.7 |         46.6 |   1.57x |
| gif, version 10             |   14.4 |         17.8 |   1.23x |

| Decode (µs)                 |    rip | paulmillr/qr | speedup |
|-----------------------------|-------:|-------------:|--------:|
| 132x132 raster, version 1   |   33.0 |          112 |   3.38x |
| 1280x720 frame, one symbol  |    620 |          996 |   1.61x |
| 1920x1080 frame, one symbol |   1489 |         2190 |   1.47x |
| 1920x1080 weave, no symbol  |   5403 |        23660 |   4.38x |

Encode inputs are `Hello world`, 192 bytes and 768 bytes of text. Decode
inputs are synthetic RGBA frames with one symbol centered on a flat
background, plus a full-frame weave for the miss case, which is dominated
by the finder search; this package walks it on packed words.

Encode timings are sensitive to which symbol size a process sees first.
A version 1 symbol fits one 32-bit word per row and never fills a word, so
a JIT that meets it first specializes the encoder on small integers; the
first larger symbol then produces full words, which JavaScript reads as
doubles from an unsigned array, and the recompiled mixed-type code runs
slower for the rest of the process. This package stores matrix words in an
`Int32Array`, so a full word is an ordinary integer in every version and
the encoder keeps one specialization whatever order the sizes arrive in.

A personal note from the author of this port: Paul Miller, who wrote the
reference implementation, is a friend of mine and wickedly smart. Coming
even close to what he built took invoking the greatest AI frontier model
in the world, and a great deal of measuring.

## Test

```bash
bun run test      # rip test.rip, the contract
bun run corpus    # rip test/corpus.rip, the ZXing blackbox scorecard; --record matches test/corpus.txt
bun run bench     # rip test/bench.rip, the timing contract
bun run compare   # rip test/compare.rip, the race against paulmillr/qr (needs misc/qr)
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

## Design

The QR encoder keeps a symbol as one `Int32Array` with 32 modules per word,
builds the function-pattern template, placement order and the eight mask
planes once per version, and chooses a mask by XORing whole words and
scoring the penalty rules word-parallel. The decoder binarizes a four-level
image pyramid against 8x8 block thresholds, finds finder patterns with
run-length windows that consume a word at a time, projects the best triple
through a homography, and corrects with Reed-Solomon, all inside buffers
allocated once per scanner so a camera frame never allocates. The Code 128
encoder chooses the shortest subset sequence by dynamic programming, and
its reader walks scan lines along both axes and along a label's measured
tilt, naming each codeword by its edge-to-edge distances and tracking the
label's corners along its bars. PDF417 compacts text, bytes and digits the
way the specification recommends and lays the stream into stacked rows
with GF(929) parity; its reader finds a start or stop pattern on a scan
line, tracks both edges up and down the stack, samples rays across every
row along the direction between them, votes each codeword into the cell
its row indicators and cluster name, and corrects erasures and errors
together.

One file per symbology, `qr.rip`, `pdf417.rip` and `code128.rip`, each
holding its tables, encoder and reader; a root entry that re-exports all
three; the camera and canvas plumbing in `dom.rip`; and the GIF writer, ECI
table and image-input helpers the symbologies share. The package is
browser-safe (`rip.browser: true`). The QR half is a port of
[paulmillr/qr](https://github.com/paulmillr/qr); PDF417 and Code 128 are
original to this package.

## Lens physics

Whether a camera can read the PDF417 on the back of a driver's license
is decided before any code runs, by two constraints on the distance
between lens and card. The readers want a module at least one pixel wide
in the frame they see, and reliably about two; the lens has to hold the
card in focus at that distance. Some cameras satisfy both at once and
some cannot satisfy them at any distance.

Pixels per module for a flat card at distance `d` with module size `X`:

```
p = X / d × W / (2 · tan(HFOV / 2))
```

`W` is the delivered frame width and `HFOV` the horizontal field of view.
The second factor is a constant for a camera: how many pixels it lays
across one unit of `X / d`. AAMVA allows a license PDF417 an `X` as small
as 6.6 mil, and most cards print between 6.6 and 10 mil, so the card must
sit within the distance where that constant, times `X`, still yields two
pixels.

**A fixed-focus ultra-wide webcam**, such as the camera built into an
Apple Studio Display: 1920 pixels wide at most, a 122° diagonal lens whose
16:9 crop spans roughly 115° horizontally, fixed focus set for a person at
desk distance.

```
1920 / (2 · tan 57.5°) ≈ 611 px per unit of X / d
```

| Module X | 1 px per module | 2 px per module |
| --- | --- | --- |
| 6.6 mil | d ≤ 4.0 in | d ≤ 2.0 in |
| 10 mil | d ≤ 6.1 in | d ≤ 3.1 in |

The card has to be two to six inches from the lens. A small-sensor f/2.4
ultra-wide of this class holds acceptable focus down to roughly ten to
fifteen inches; inside six inches the blur circle spans several pixels,
and with modules one or two pixels wide any blur beyond half a module
erases the bars. The two windows never overlap: sharp only beyond a foot,
resolvable only inside six inches. No zoom capability is offered, so
nothing trades field of view for pixels.

**A phone's main camera**: 3840 pixels wide, a lens near 70° horizontal,
and a zoom that crops the sensor. `rearCamera` asks for the full sensor and
the scan demo opens at 2x, about 35° across.

```
3840 / (2 · tan 17.5°) ≈ 6100 px per unit of X / d
```

| Module X | 1 px per module | 2 px per module |
| --- | --- | --- |
| 6.6 mil | d ≤ 40 in | d ≤ 20 in |
| 10 mil | d ≤ 61 in | d ≤ 31 in |

Autofocus reaches down to about four inches, so the sharp window and the
resolvable window overlap by more than a foot, and the card reads at an
ordinary hand-held distance. Ten times the pixels per unit of angle is
the whole difference; the lens's ability to focus close merely lets the
card use them.

The frame sizes and module sizes are hard numbers; the fields of view and
the near focus limit are lens-class figures. They would have to be off by
a factor of three, in the same direction, for the webcam's two windows to
touch. QR fares better on the webcam only because its modules are larger:
a printed QR with 20 mil modules resolves at a foot, right where the lens
is sharp.

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
