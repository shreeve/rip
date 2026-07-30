# Pulse

A tiny status board that proves the whole stack end to end: Rip Server
serves the boot page, the bundle, and a small API; Rip App renders the
page in the browser; and behind Janus, saving a component file updates
the running page through the Workspace door.

It is a runnable example and a demo script — not a test suite. Nothing
here is wired into CI.

## Layout

| File | Role |
| --- | --- |
| `index.rip` | The server: statuses API, `start! 'app'` |
| `app/index.html` | SPA shell (`bootApp` over `/bundle.json`) |
| `app/stash.rip` | `stash` — the `statuses` source over `/api/statuses` |
| `app/mood.rip` | `MoodBadge`, the mood → label leaf. **This is the file the live demo edits.** |
| `app/routes/index.rip` | The page: post form + the status list through `MoodBadge` |

The `app/` directory is the browser app; its disk paths are the bundle's
store paths (`app/routes/index.rip` is the `/` route, `app/stash.rip` the
stash contract). Route files live under `app/routes/`.

## The API

Two endpoints over an in-memory list. Each status is
`{ text, mood, timestamp }` — the server stamps the timestamp.

- `GET /api/statuses` — the full list, as JSON.
- `POST /api/statuses` — JSON body `{ "text": "...", "mood": "up" | "even" | "down" }`.
  Answers the created status. Validation is loud: a missing `text`,
  a `text` over 140 characters, or a `mood` outside the vocabulary is
  a 400 with a named message — never a silent default.

Statuses live in the worker's memory. Standalone that means they last
until you stop the process; pooled behind Janus, any pool reload (a
server-file save, a restart) boots fresh workers and clears the list.

## Leg 1 — standalone

```bash
cd examples/pulse
rip index.rip
```

Open the printed URL (http://localhost:3000). The page boots from
`/bundle.json`, the seeded status renders through its mood badge,
and posting from the form updates the list in place — the handler POSTs,
then refetches the `statuses` source.

## Leg 2 — pooled behind Janus

With a Janus control endpoint running (`--control <target>` or the
`JANUS_CONTROL` env var):

```bash
cd examples/pulse
rip server index.rip --name pulse --bridge /hub
```

The same `index.rip` now runs as a worker pool: the manager registers
`pulse` with Janus, compiles the app and assembles the bundle once per
boot epoch, and spawns workers on unix sockets. Caddy terminates TLS;
Janus admits the host, routes it to the live worker sockets
(least-conn with health), answers anonymous GETs from its micro-cache,
and owns the hub — `--bridge /hub` registers the endpoint Janus POSTs
every hub socket event to.

## Leg 3 — the door

Same as leg 2, with the flag in the manager's environment:

```bash
cd examples/pulse
rip server index.rip --name pulse --bridge /hub
```

Open the page, then edit `app/mood.rip`: change the `up` label
`'riding high'` to anything else and save. The manager sees a
client-only change, bumps the cell's rev, and dings the hub with
`{id, rev}` — no bytes ride the socket. The page fetches the rev-keyed
cell over HTTP, sets it into the Workspace, and every badge on the page
updates without a manual refresh.

The update applies by **remount labeled escape** (docs/WORKSPACE.md,
M1): the route remounts against the new component, and the console says
so — this is the door working, not hot state-preserving apply.

## Leg 4 — live collaboration

No new commands: any pooled run (leg 2 or 3) already carries it. Open
the page in TWO browser windows and post from one — the other's list
updates without a refresh.

The mechanism is the app-level twin of the dev feed, over the same
Janus hub, under the same doctrine — **the frame is a hint, the data
rides HTTP**:

- On mount the page opens a `/hub` socket and self-enrolls with
  `{"+": ["/pulse"]}` — a client-legal hub directive; the worker is
  not involved.
- After a successful POST the poster sends
  `{"@": ["/pulse"], "changed": {}}`; Janus fans it out to every
  member at the edge.
- Each member (the poster included — the echo is idempotent) refetches
  `GET /api/statuses`. The frame never carries a status, so a spoofed
  frame can only cause a harmless refetch: the server stays
  authoritative.
