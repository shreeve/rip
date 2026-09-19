// Process-lifetime helpers for tests that watch a child come and go.

export const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Polls every 50ms until the predicate holds or `ms` has passed; the last
// check runs after the deadline so a slow box still gets a fair answer.
export const until = async (predicate, ms) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(50);
  }
  return predicate();
};
