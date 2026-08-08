// Spawn helpers for the process lane (`test/spawn/**` only).
//
// Always pass an explicit env with FORCE_COLOR removed. Bun's default
// inherit keeps the process's *startup* FORCE_COLOR even after
// `delete process.env.FORCE_COLOR`, which paints console.log/inspect in
// piped children and breaks stdout pins. Pass `keepForceColor: true` only
// when the child itself must see FORCE_COLOR (rare).
//
// Importing this module also scrubs FORCE_COLOR from Bun.spawn* options
// so spawn-lane files that use Bun's API stay paint-free without a
// global test preload.

import childProcess from 'node:child_process';

const scrub = (env, keep) => {
  const e = { ...(env ?? process.env) };
  if (!keep) delete e.FORCE_COLOR;
  return e;
};

const prepare = (options) => {
  const keep = Boolean(options?.keepForceColor);
  const rest = { ...(options ?? {}) };
  delete rest.keepForceColor;
  return { ...rest, env: scrub(rest.env, keep) };
};

export const spawnSync = (command, args, options) => {
  if (args != null && !Array.isArray(args)) {
    options = args;
    args = undefined;
  }
  const opts = prepare(options);
  return args === undefined
    ? childProcess.spawnSync(command, opts)
    : childProcess.spawnSync(command, args, opts);
};

export const spawn = (command, args, options) => {
  if (args != null && !Array.isArray(args)) {
    options = args;
    args = undefined;
  }
  const opts = prepare(options);
  return args === undefined
    ? childProcess.spawn(command, opts)
    : childProcess.spawn(command, args, opts);
};

const scrubBun = (options) => {
  const env = { ...(options?.env ?? process.env) };
  delete env.FORCE_COLOR;
  return { ...(options ?? {}), env };
};

if (!Bun.spawn.__ripSpawnScrubbed) {
  const origSync = Bun.spawnSync.bind(Bun);
  Bun.spawnSync = (cmd, options) => origSync(cmd, scrubBun(options));
  Bun.spawnSync.__ripSpawnScrubbed = true;

  const orig = Bun.spawn.bind(Bun);
  Bun.spawn = (cmd, options) => orig(cmd, scrubBun(options));
  Bun.spawn.__ripSpawnScrubbed = true;
}
