# hello-app

Minimal browser-App-only shape:

- authored modules under `app/`;
- one manager-generated `bundle.json`;
- a watch-only `manifest.json`;
- finite Janus file roots;
- an authored or explicitly generated shell;
- no API entry and no workers.

Janus serves every public byte.

## Publication checklist

- Initial publication and ambiguous directory events walk every member selected
  by `serve.rip` `app.manifest` into an ephemeral in-memory snapshot. Ordinary
  file events reread and rehash only the exact watcher-reported ids. The
  conventional policy selects `app/**/*.{rip,css,html}`. Each id is relative
  to the App root, so the disk file `app/routes/index.rip` is
  `routes/index.rip` in the bundle, manifest, ding, and Workspace.
- Each entry receives one six-character content rash. The wire field is
  `hash`; its value is that rash.
- Entries sort by `id`. The App check is
  `rash(JSON.stringify(entries.map(({id, hash}) => [id, hash])))`.
- `bundle.json` and `manifest.json` enumerate the same complete inventory and
  carry the same top-level `check`.
- The bundle retains the browser's `modules` and `packages` boot ABI and carries
  selected content, initially every `.rip` source. The manifest carries no file
  content.
- A ding batch is the changed subset of manifest entries. Each ding describes
  exactly one file; an empty change set sends no publish request. Deletions are
  tombstones and are absent from the new inventory.
- Bundle and manifest candidates come from the same snapshot. The manager
  commits the bundle first and the manifest second using atomic renames.
- Unchanged bytes are not rewritten. The manager retains committed metadata,
  not a permanent in-memory copy of App source.
- The shared check is App inventory identity. Janus independently supplies
  each file's weak mtime/size ETag and conditional HTTP behavior.
