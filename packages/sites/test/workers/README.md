# workers

Worker-runtime shape:

- readiness before admission; workers that miss the readiness deadline are
  killed by the manager;
- configured per-worker concurrency; invalid worker concurrency rejects
  before binding;
- busy and draining markers consumed by Janus;
- graceful completion on shutdown;
- boot-failure reporting;
- crash replacement, hung-handler recycling, and orphan exit.

Every worker boots the same generated `APP_ARTIFACT`; source-entry boot is not
part of this fixture.
