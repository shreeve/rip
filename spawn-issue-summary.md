# Rip-Server Spawn Issue Summary

## 🎯 **The Problem**

The `server/manager.ts` file cannot spawn worker processes using `Bun.spawn()`. Every attempt results in `ENOENT: no such file or directory, posix_spawn` errors, preventing the full rip-server architecture from working.

## 🌟 **Current Status**

- ✅ **API Works Perfectly**: `api/index.rip` runs flawlessly standalone with `bun index.rip`
- ✅ **All Endpoints Functional**: Returns proper JSON responses for `/`, `/health`, `/info`
- ❌ **Enterprise Architecture Blocked**: Can't use the full rip-server with manager → workers

## 🔧 **System Environment**

- **OS**: macOS (darwin 25.0.0)
- **Bun Version**: 1.2.18
- **Shell**: /bin/zsh
- **Bun Location**: `/Users/shreeve/.bun/bin/bun` (57MB, executable, verified working)
- **PATH**: Contains bun (`which bun` returns `/Users/shreeve/.bun/bin/bun`)

## 📋 **What We've Tried**

### 1. **Hardcoded Full Path**
```typescript
const workerProcess = Bun.spawn([
  "/Users/shreeve/.bun/bin/bun",
  // ...
]);
```
**Result**: `ENOENT: no such file or directory, posix_spawn '/Users/shreeve/.bun/bin/bun'`

### 2. **Simple "bun" Command**
```typescript
const workerProcess = Bun.spawn([
  "bun",
  // ...
]);
```
**Result**: `ENOENT: no such file or directory, posix_spawn 'bun'`

### 3. **Bun.which() Resolution**
```typescript
const bunPath = Bun.which("bun") || "bun";
const workerProcess = Bun.spawn([bunPath, ...]);
```
**Result**: Still uses `/Users/shreeve/.bun/bin/bun` and fails with ENOENT

### 4. **process.execPath**
```typescript
const workerProcess = Bun.spawn([
  process.execPath,
  // ...
]);
```
**Result**: Same ENOENT error with `/Users/shreeve/.bun/bin/bun`

### 5. **Environment PATH Resolution**
```typescript
const workerProcess = Bun.spawn([
  "bun",
  // ...
], {
  env: {
    ...process.env,
    PATH: process.env.PATH
  }
});
```
**Result**: Still can't find "bun"

### 6. **/usr/bin/env Approach**
```typescript
const workerProcess = Bun.spawn([
  "/usr/bin/env",
  "bun",
  // ...
]);
```
**Result**: `ENOENT: no such file or directory, posix_spawn '/usr/bin/env'`

## 🔍 **Verification Tests**

All of these work perfectly in the shell:
```bash
# All succeed
ls -la /Users/shreeve/.bun/bin/bun          # ✅ File exists, executable
which bun                                    # ✅ Returns path
bun --version                               # ✅ 1.2.18
bun api/index.rip                           # ✅ Runs perfectly
ls -la /usr/bin/env                         # ✅ Exists, executable
/usr/bin/env bun --version                  # ✅ Works
```

## 📂 **Current Code Structure**

### manager.ts (relevant section):
```typescript
const spawnWorker = async (workerId: number): Promise<Worker> => {
  // ... socket cleanup ...

  // Use Bun.spawn with env to find bun in PATH
  const workerProcess = Bun.spawn([
    "/usr/bin/env",
    "bun",
    join(__dirname, "worker.ts"),
    workerId.toString(),
    maxRequestsPerWorker.toString(),
    appDirectory
  ], {
    stdout: "inherit",
    stderr: "inherit",
    cwd: appDirectory,
    env: {
      ...process.env,
      PATH: process.env.PATH
    }
  });

  // ... rest of worker setup ...
}
```

## 🤔 **Mysterious Aspects**

1. **File Exists & Executable**: The bun binary is confirmed to exist and be executable
2. **Shell vs Spawn**: Works perfectly in shell, fails in `Bun.spawn()`
3. **Even /usr/bin/env Fails**: Even fundamental system binaries can't be spawned
4. **Permissions Look Good**: All files have proper execute permissions
5. **Process Context**: The manager itself is running via bun, so bun is clearly working

## 🎯 **The Goal**

Get this working so we can run:
```bash
server/rip-server dev true api
```

And see the full enterprise architecture:
- **Server** (load balancer on port 3000)
- **Manager** (process management + hot reload)
- **3 Workers** (sequential request handlers)
- **Unix Sockets** (high-performance IPC)
- **Hot Reload** (file watching for .rip files)

## 📊 **Impact**

- **High**: Blocks full rip-server demonstration
- **Medium**: API works standalone, so core functionality proven
- **Workaround**: Users can run `bun api/index.rip` directly

## 🎉 **SOLUTION FOUND!**

The issue was that `Bun.spawn()` fails when the process is started through a chain of shell scripts using `exec`. The shell script's `exec` command replaces the process, which somehow breaks Bun's ability to spawn child processes.

### Working Solutions:

1. **TypeScript Launcher** (WORKS ✅)
   - Created `launcher.ts` that uses `Bun.spawn()` directly
   - Bypasses shell script chain entirely
   - All processes start successfully

2. **Direct Execution** (WORKS ✅)
   - Running `bun manager.ts` directly works perfectly
   - Spawns all workers without issues

3. **Shell Script Without exec** (Partially tested)
   - Removing `exec` from shell scripts may help
   - Needs more testing

### Root Cause:
When Bun processes are started through shell scripts using `exec`, the spawn syscall fails with ENOENT even for commands that clearly exist. This appears to be a Bun-specific issue with how it handles process spawning in certain execution contexts.

### Recommendation:
Use the TypeScript launcher (`launcher.ts`) for now, or run the components directly. This provides the full enterprise rip-server architecture while we investigate a permanent fix for the shell script chain.