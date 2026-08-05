# Hello App

A minimal browser-only Rip App with no API workers. Permanent publication
details live in [`docs/SERVER.md`](../../docs/SERVER.md); browser consumption
details live in [`docs/WORKSPACE.md`](../../docs/WORKSPACE.md).

## Add and start

In the Rip tray, choose **Add App…**, then select this project directory:

```text
packages/site/demos/hello
```

Select the directory containing `serve.rip`, not `app/` and not the
`serve.rip` file itself. The picker runs the equivalent of:

```sh
rip sites add packages/site/demos/hello
rip sites start hello
```

`serve.rip` declares the `hello` name, `hello.ripdev.io` host, conventional
`app/` root, and explicit default change policy.

## Server publication

Manager writes these files under `dist/`:

```text
@rip/rip.js
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
