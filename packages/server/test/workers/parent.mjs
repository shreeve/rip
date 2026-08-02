import { writeFileSync } from "node:fs";

const [worker, app, socket, report] = process.argv.slice(2);
const child = Bun.spawn([process.execPath, worker], {
  stdin: "ignore",
  stdout: "ignore",
  stderr: "ignore",
  env: {
    ...process.env,
    APP_ARTIFACT: app,
    SOCKET_PATH: socket,
    WORKER_ID: "orphan",
    RIP_PPID_MS: "25",
    RIP_DRAIN_DEADLINE_MS: "100",
  },
});

const deadline = Date.now() + 5000;
for (;;) {
  try {
    const response = await fetch("http://worker/ready", { unix: socket });
    if (response.status === 200) break;
  } catch {}
  if (Date.now() >= deadline) throw new Error("child worker did not become ready");
  await Bun.sleep(10);
}

writeFileSync(report, JSON.stringify({ pid: child.pid }));
child.unref();
