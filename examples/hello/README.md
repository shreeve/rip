# Hello App

A minimal browser-only Rip App with no API workers. This README is the
walkthrough checklist for App loading, manifest membership, and watcher
publication. Permanent protocol details live in [`docs/SERVER.md`](../../docs/SERVER.md).

## Add and start

In the Rip tray, choose **Add App…**, then select this project directory:

```text
examples/hello
```

Select the directory containing `serve.rip`, not `app/` and not the
`serve.rip` file itself. The picker runs the equivalent of:

```sh
rip app add examples/hello
rip app start hello
```

`serve.rip` explicitly declares the `hello` name, `hello.ripdev.io` host,
conventional `app/` root, and default manifest categories.

## Initial load

- [ ] Open `https://hello.ripdev.io/`.
- [ ] `index.html` loads from the authored App root.
- [ ] `rip.js` and `bundle.json` load from the generated root.
- [ ] `bundle.json` contains the four manifest members listed below.
- [ ] `/images/rip.png` loads as an ordinary static asset but is absent from
      the manifest.
- [ ] `/hub` opens and receives its join message.
- [ ] The Hello Rip page renders.

Expected manifest members:

```text
index.html
routes/index.rip
styles.css
template.html
```

## Watcher changes

With the page and its `/hub` WebSocket open:

- [ ] Edit `app/routes/index.rip`: one `update` ding and an in-place module
      apply.
- [ ] Touch or rewrite `app/routes/index.rip` with identical bytes: no ding.
- [ ] Edit `app/styles.css`: one `css` ding and an in-place stylesheet update.
- [ ] Edit `app/index.html`: one `reload` ding and a page reload.
- [ ] Edit `app/template.html`: one `reload` ding and a page reload.
- [ ] Replace `app/images/rip.png`: new static bytes and HTTP ETag, no manifest
      publication and no ding.
- [ ] Add or edit another non-manifest asset such as `app/images/note.txt`: no
      manifest publication and no ding.

## Implementation contract

- [x] `serve.rip` can override the App root and each manifest category.
- [x] Omitted categories use `**/*.rip`, `**/*.css`, and `**/*.html`; `[]`
      disables a category.
- [x] The recursive watcher observes the complete App root and filters
      ordinary asset-file events before publication.
- [x] A publication batch rehashes only manifest paths reported changed by the
      watcher; a directory or pathless event may request a full reconciliation.
