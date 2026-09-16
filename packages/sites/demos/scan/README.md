# Scan App

A camera scanner for QR codes, PDF417 symbols and Code 128 labels, and the browser example
for [`rip/barcodes`](../../../barcodes/README.md). One page, no API beyond
the Hub admit in `index.rip`, served over HTTPS on the LAN by Janus so a
phone can use its camera.

`app/routes/index.rip` opens the rear camera with `rearCamera`, runs
`frameLoop`, and hands every frame to a `QRCanvas`, which decodes QR
through the canvas path and paints the finder overlay. The same frame is
drawn into a working canvas whose pixels go to `readCode128` and then to
`readPDF417`. A hit is announced once until a different code appears; the
last twenty stay in a list.

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

Fill a good part of the frame with the code. The Code 128 and PDF417
readers want modules at least one pixel wide in the camera's native
resolution, so a label across a quarter of the view is plenty; QR decodes
from further away.
Live watch is on, so editing `app/routes/index.rip` remounts the page.
