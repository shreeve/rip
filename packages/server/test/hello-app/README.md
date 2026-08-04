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

- One filesystem walk reads every `app/**/*.{rip,css,html}` member once into
  an ephemeral in-memory snapshot. Each id is the member's path relative to
  `app/`, so the disk file `app/routes/index.rip` is `routes/index.rip` in the
  bundle, manifest, ding, and Workspace.
- Each entry receives one six-character content rash. The existing wire field
  remains `hash`; its value is that rash.
- Entries sort by `id`. The bag rash is
  `rash(JSON.stringify(entries.map(({id, hash}) => [id, hash])))`.
- `bundle.json` and `manifest.json` enumerate the same complete inventory and
  carry the same top-level `rash`.
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
- The shared rash is App identity. Janus independently supplies each file's
  weak mtime/size ETag and conditional HTTP behavior.
