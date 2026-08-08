# Hello App

A minimal Rip App demo: `app/` plus a tiny Hub-admit API (`index.rip`) so
live watch works on the packaged bridge-mode edge. Permanent publication
details live in [`docs/SERVER.md`](../../docs/SERVER.md); browser consumption
details live in [`docs/WORKSPACE.md`](../../docs/WORKSPACE.md).

## Add and start

In the Rip tray, choose **Add Site…**, then select this project directory:

```text
packages/sites/demos/hello
```

Select the directory containing `serve.rip`, not `app/` and not the
`serve.rip` file itself. The picker runs the equivalent of:

```sh
rip sites add packages/sites/demos/hello
rip sites start hello
```

`serve.rip` declares the `hello` name, dual hosts (`hello.ripdev.io` for
loopback, `hello.local` for LAN after `rip sites expose local`), conventional
`app/` root, and explicit default change policy.

## LAN / phone

```sh
rip sites stop hello          # mode flips refuse while sites run
rip sites trust edge
rip sites expose local
rip sites start hello
# Mac:     https://hello.local/
# Phone:   install CA from http://sites.local/trust (then Full Trust on iOS)
#          open https://hello.local/
```

`*.ripdev.io` still resolves only to `127.0.0.1` — phones need the `.local`
host and the trusted local CA.

## Server publication

Manager writes these files under `dist/`:

```text
@rip/rip.min.js
@rip/rip.min.js.br
bundle.json
bundle.json.br
latest.json
```

`bundle.json` has exactly `hash` and `list`. This App's source list contains
only `routes/index.rip`. The stylesheet, HTML shell, template, and image remain
ordinary HTTP files; their bytes are not embedded in the bundle. Because the
default change policy manages every non-hidden App file, their private hashes
still contribute to the complete App hash.

`bundle.json.br` is the Brotli representation of the exact JSON bytes.
`latest.json` contains the same complete App hash. There is no manifest.

## Watcher checklist

With Server watch mode active:

- [ ] Edit `app/routes/index.rip`: one change contains
      `["routes/index.rip", source]`.
- [ ] Rewrite `app/routes/index.rip` with identical bytes: no change.
- [ ] Edit `app/styles.css`: one change contains `["styles.css"]`.
- [ ] Edit `app/index.html`: one change contains `["index.html"]`.
- [ ] Edit `app/template.html`: one change contains `["template.html"]`.
- [ ] Replace `app/images/rip.png`: one change contains
      `["images/rip.png"]`; the bytes remain on HTTP.
- [ ] Delete a managed file: one change contains `[path, null]`.
- [ ] Every change's `from` equals the prior App hash and its `hash` equals the
      new `bundle.json` and `latest.json` hash.

The Server suite proves publication and transport, and the browser suites prove
the same bundle, ordered-change, and reconnect contracts through Rip App.
