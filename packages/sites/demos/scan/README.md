# Scan App

A camera scanner for QR codes, PDF417 symbols and Code 128 labels, and the browser example
for [`rip/barcodes`](../../../barcodes/README.md). One page, no API beyond
the Hub admit in `index.rip`, served over HTTPS on the LAN by Janus so a
phone can use its camera.

`app/routes/index.rip` opens the rear camera with `rearCamera` at the
sensor's full size, runs `frameLoop`, and hands every frame to a
`QRCanvas`, which decodes QR through the `VideoFrame` path and paints the
finder overlay. The luma that lands in the scanner's arena goes on to
`readCode128` and then `readPDF417` with no further copy. A hit is
announced once until a different code appears; the last twenty stay in a
list.

A stats line shows the delivered stream size and frame rate, frames per
second, milliseconds per frame, reads per frame since the last reset and
the time to the first read, so a change to the pipeline is measured
rather than felt. The controls reopen the camera at 720p, 1080p or 4K,
set the zoom where the browser offers it (iOS 17+ and Android), switch
the torch, and reset the counters.

## Add and start

From the repository root:

```bash
rip sites add packages/sites/demos/scan
rip sites start scan
rip sites open scan
```

## LAN / phone

Camera access needs a secure context, so the phone must reach a `.local`
name over HTTPS and trust Janus's CA:

```bash
janus trust
janus mode lan
rip sites start scan
# Mac:     https://scan.via.rip/  or  https://scan.local/
# Phone:   trust the CA at http://janus.local/trust (it walks you through it)
#          open https://scan.local/ and allow the camera
```

`*.via.rip` resolves only to `127.0.0.1`; phones need the `.local` host.
Camera permission is per origin, so the phone asks once.

## Reading tips

Fill the box with the code. The Code 128 and PDF417 readers want modules
at least a pixel or two wide in the frame the readers see: at 1080p a
driver's license reads out to about 24 cm, at 4K or with 2x zoom out to
about 45 cm, and QR reads from much further. The stats line tells you
what the camera actually delivered; if it says 640x480, the browser
ignored the request and the box must be filled from very close.
Live watch is on, so editing `app/routes/index.rip` remounts the page.
