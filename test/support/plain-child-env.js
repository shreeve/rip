// Optional Bun.spawn* FORCE_COLOR scrub for callers that cannot import
// test/support/spawn.js (named imports are not monkeypatchable under Bun).
// The process lane imports spawn.js instead — that module installs the
// same scrub once. Do not add this file to bunfig preload: in-process
// suites do not spawn and must not pay a global wrap.

delete process.env.FORCE_COLOR;

const scrub = (options) => {
  const env = { ...(options?.env ?? process.env) };
  delete env.FORCE_COLOR;
  return { ...(options ?? {}), env };
};

const origBunSpawnSync = Bun.spawnSync.bind(Bun);
Bun.spawnSync = (cmd, options) => origBunSpawnSync(cmd, scrub(options));

const origBunSpawn = Bun.spawn.bind(Bun);
Bun.spawn = (cmd, options) => origBunSpawn(cmd, scrub(options));
