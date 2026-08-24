# hello-api

Minimal API-only shape:

- one authored API entry, plus the `entry.rip` generation probe;
- one generated JavaScript artifact;
- one worker on a Unix socket;
- one route through Janus;
- readiness and clean foreground shutdown.

There is no browser `app/` directory and no public file root.
