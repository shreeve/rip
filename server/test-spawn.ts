#!/usr/bin/env bun

/**
 * Test Bun.spawn() behavior to diagnose ENOENT issues
 */

console.log('=== Bun.spawn() Diagnostic Test ===\n')

// System info
console.log('System Information:')
console.log(`- OS: ${process.platform} ${process.version}`)
console.log(`- Bun version: ${Bun.version}`)
console.log(`- Current directory: ${process.cwd()}`)
console.log(`- Script directory: ${import.meta.dir}`)
console.log(`- process.execPath: ${process.execPath}`)
console.log(`- Bun.which("bun"): ${Bun.which('bun')}`)
console.log(`- PATH: ${process.env.PATH}`)
console.log('')

// Test cases
const testCases = [
  {
    name: "Test 1: Simple 'echo' command",
    cmd: ['echo', 'hello world'],
    options: {},
  },
  {
    name: 'Test 2: /bin/echo with full path',
    cmd: ['/bin/echo', 'hello world'],
    options: {},
  },
  {
    name: 'Test 3: Bun with process.execPath',
    cmd: [process.execPath, '--version'],
    options: {},
  },
  {
    name: 'Test 4: Bun with Bun.which()',
    cmd: [Bun.which('bun') || 'bun', '--version'],
    options: {},
  },
  {
    name: "Test 5: Simple 'bun' command",
    cmd: ['bun', '--version'],
    options: {},
  },
  {
    name: 'Test 6: /usr/bin/env bun',
    cmd: ['/usr/bin/env', 'bun', '--version'],
    options: {},
  },
  {
    name: 'Test 7: Shell command with /bin/sh',
    cmd: ['/bin/sh', '-c', "echo 'shell test'"],
    options: {},
  },
  {
    name: 'Test 8: Bun with explicit PATH',
    cmd: ['bun', '--version'],
    options: {
      env: {
        ...process.env,
        PATH: process.env.PATH,
      },
    },
  },
  {
    name: 'Test 9: Absolute path to bun',
    cmd: ['/Users/shreeve/.bun/bin/bun', '--version'],
    options: {},
  },
]

// Run tests
for (const test of testCases) {
  console.log(`\n${test.name}:`)
  console.log(`Command: ${JSON.stringify(test.cmd)}`)

  try {
    const proc = Bun.spawn(test.cmd, {
      ...test.options,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const output = await new Response(proc.stdout).text()
    const error = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    console.log(`✅ Success! Exit code: ${exitCode}`)
    if (output.trim()) console.log(`Output: ${output.trim()}`)
    if (error.trim()) console.log(`Error: ${error.trim()}`)
  } catch (err) {
    console.log(`❌ Failed: ${err.message}`)
  }
}

console.log('\n=== End of diagnostic test ===')
