# reloads

Full App-and-API reload shape:

- App-only edits update publication without replacing API workers;
- API edits prepare a complete candidate before cutting admission;
- a broken candidate leaves the active pool and App usable;
- accepted workers replace the pool without dropping Janus-held connections;
- missed file dings recover through the manifest.

The fixture distinguishes browser publication from server artifact generation.
