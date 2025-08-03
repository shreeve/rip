#!/usr/bin/env bun

console.log("Testing Bun.spawn with preload active...");
console.log("Preload from bunfig:", process.env.BUN_CONFIG_PRELOAD);

try {
  // Try spawning a simple echo command
  const proc = Bun.spawn(["echo", "hello"], {
    stdout: "pipe"
  });
  
  const output = await new Response(proc.stdout).text();
  console.log("✅ Basic spawn works:", output.trim());
} catch (err) {
  console.log("❌ Basic spawn failed:", err.message);
}

try {
  // Try spawning bun itself
  const proc = Bun.spawn(["bun", "--version"], {
    stdout: "pipe",
    stderr: "pipe"
  });
  
  const output = await new Response(proc.stdout).text();
  console.log("✅ Bun spawn works:", output.trim());
} catch (err) {
  console.log("❌ Bun spawn failed:", err.message);
}

try {
  // Try spawning with absolute path
  const proc = Bun.spawn([process.execPath, "--version"], {
    stdout: "pipe",
    stderr: "pipe"
  });
  
  const output = await new Response(proc.stdout).text();
  console.log("✅ Absolute path spawn works:", output.trim());
} catch (err) {
  console.log("❌ Absolute path spawn failed:", err.message);
}