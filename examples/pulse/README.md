# Pulse

A tiny status board that proves the whole stack end to end: Janus serves
the browser App, Rip Server handles a small API, and saving a component
file updates the running page through the Workspace door.

It is a runnable example and a demo script — not a test suite. Nothing
here is wired into CI.

## Layout

| File | Role |
| --- | --- |
| `index.rip` | The API: statuses routes and bare `start!` handoff |
| `app/index.html` | SPA shell (`bootApp` over `/bundle.json`) |
| `app/stash.rip` | `stash` — the `statuses` source over `/api/statuses` |
| `app/mood.rip` | `MoodBadge`, the mood → label leaf. **This is the file the live demo edits.** |
| `app/routes/index.rip` | The page: post form + the status list through `MoodBadge` |

The `app/` directory is the browser app. Bundle, manifest, ding, and Workspace
paths are relative to that root: `routes/index.rip` is the `/` route and
`stash.rip` is the stash contract. Route files live on disk under
`app/routes/`.

## The API

Two endpoints over an in-memory list. Each status is
`{ text, mood, timestamp }` — the server stamps the timestamp.

- `GET /api/statuses` — the full list, as JSON.
- `POST /api/statuses` — JSON body `{ "text": "...", "mood": "up" | "even" | "down" }`.
  Answers the created status. Validation is loud: a missing `text`,
  a `text` over 140 characters, or a `mood` outside the vocabulary is
  a 400 with a named message — never a silent default.

Statuses live in worker memory. Any pool reload (an API-source save or a
restart) boots fresh workers and clears the list.

## Run

With a Janus control endpoint running (`--control <target>` or the
`JANUS_CONTROL` env var):

```bash
cd examples/pulse
rip server index.rip --name pulse
```

The manager registers `pulse` with Janus, publishes the browser App,
prepares the API artifact, and spawns workers on unix sockets. Caddy terminates TLS;
Janus admits the host, routes it to the live worker sockets
(least-conn with health), answers anonymous GETs from its micro-cache,
and owns the Hub directly.

## Leg 3 — the door

Same as leg 2, with the flag in the manager's environment:

```bash
cd examples/pulse
rip server index.rip --name pulse
```

Open the page, then edit `app/mood.rip`: change the `up` label
`'riding high'` to anything else and save. The manager sees a
client-only change and dings the Hub with `{id, hash}` — no bytes ride the
socket. The page fetches the latest file over HTTP, verifies its hash,
sets it into the Workspace, and every badge on the page
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
