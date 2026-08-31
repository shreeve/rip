# Pulse

Middle rung of the [demos ladder](../README.md): a tiny status board that
proves the stack end to end — Janus serves the browser App, Rip Sites
handles a small API, saving a component remounts through the Workspace
feed, and Hub members collaborate with hint-only frames.

It is a runnable example and a demo script — not a test suite. Nothing
here is wired into CI; the live-Site gates run against the browser
suite's own fixture (`test/browser/hmr-app`, `bun run test:live`).

## Layout

| File | Role |
| --- | --- |
| `serve.rip` | Catalog name, hosts, Hub bridge (tray **Add Site…** target) |
| `index.rip` | The API: statuses routes and bare `start!` handoff |
| `app/index.html` | SPA shell (`bootApp` over `/bundle.json`) |
| `app/stash.rip` | `stash` — the `statuses` source over `/api/statuses` |
| `app/mood.rip` | `MoodBadge`, the mood → label leaf. **This is the file the live demo edits.** |
| `app/routes/index.rip` | The page: post form + the status list through `MoodBadge` |

The `app/` directory is the browser App. Publication and Workspace paths are
relative to that root: `routes/index.rip` is the `/` route and `stash.rip` is
the stash contract. Route files live on disk under `app/routes/`.

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

With the edge up (`rip sites start edge`), add and start from this
directory (or pass `--name` / `--host` explicitly):

```bash
rip sites add packages/sites/demos/pulse
rip sites start pulse
rip sites open pulse          # https://pulse.via.rip/
```

One-shot without the catalog:

```bash
cd packages/sites/demos/pulse
rip sites run --name pulse
```

The manager registers `pulse` with Janus, publishes the browser App,
prepares the API artifact, and spawns workers on unix sockets. Caddy terminates TLS;
Janus admits the host, routes it to the live worker sockets
(least-conn with health), and owns the Hub directly.

## Live publication

With the app running (see [Run](#run) above):

```bash
cd packages/sites/demos/pulse
rip sites run --name pulse
```

Open the page, then edit `app/mood.rip`: change the `up` label
`'riding high'` to anything else and save. The manager sees a
client-only change and publishes one `change {from,hash,list}` through the
Hub. The list carries the changed Rip source. Rip App stages that source,
advances the Workspace atomically, and every badge on the page updates without
a manual refresh.

A label-only edit like this applies by **in-place definition patching**
(docs/HMR.md, "Layer B — refresh tiers"): the component updates with focus
preserved, and remount is the fallback when a patch cannot apply.

## Live collaboration

No new commands: any pooled run (see [Run](#run)) already carries it. Open
the page in TWO browser windows and post from one — the other's list
updates without a refresh.

This application-owned mechanism shares the Janus Hub but is independent of
file publication. Its frame is a hint and its data rides HTTP:

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
