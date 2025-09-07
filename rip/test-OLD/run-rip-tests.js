#!/usr/bin/env bun
/**
 * Test Runner for Rip Language Tests
 * Executes .rip test files to verify language features work correctly
 */

import { execSync } from 'child_process';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

console.log('\n' + '='.repeat(60));
console.log('🚀 RIP LANGUAGE FEATURE TESTS');
console.log('='.repeat(60));
console.log('\nTesting Rip WITH Rip! How meta! 🎭\n');

const featuresDir = './test/features';
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

try {
  // Get all .rip test files
  const testFiles = readdirSync(featuresDir)
    .filter(f => f.endsWith('.rip'))
    .sort();

  console.log(`Found ${testFiles.length} test suites:\n`);

  // Run each test file
  for (const file of testFiles) {
    const filepath = join(featuresDir, file);
    const testName = file.replace('.rip', '');

    console.log(`📝 Running ${testName} tests...`);

    try {
      // Execute the test file with our Rip CLI
      const output = execSync(`./bin/rip ${filepath}`, {
        encoding: 'utf-8',
        stdio: 'pipe'
      });

      // Count the test results
      const passes = (output.match(/✓/g) || []).length;
      const fails = (output.match(/✗/g) || []).length;

      totalTests += passes + fails;
      passedTests += passes;
      failedTests += fails;

      // Show the output
      console.log(output);

      if (fails > 0) {
        console.log(`  ⚠️  ${fails} test(s) failed in ${testName}`);
      }

    } catch (error) {
      console.log(`  ❌ Error running ${file}:`);
      console.log(`     ${error.message}`);
      failedTests++;
    }
  }

  // Summary
  console.log('='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`\n  Total Tests:  ${totalTests}`);
  console.log(`  ✅ Passed:     ${passedTests}`);
  console.log(`  ❌ Failed:     ${failedTests}`);

  const percentage = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0;
  console.log(`  📈 Pass Rate:  ${percentage}%`);

  // Status message
  if (failedTests === 0 && totalTests > 0) {
    console.log('\n🎉 ALL TESTS PASSED! Rip is working beautifully! 🎉');
  } else if (passedTests > failedTests) {
    console.log(`\n💪 Looking good! Most tests are passing.`);
  } else if (totalTests === 0) {
    console.log('\n⚠️  No tests were run.');
  } else {
    console.log(`\n🔧 Some work needed - ${failedTests} tests to fix.`);
  }

  console.log('\n' + '='.repeat(60) + '\n');

  // Exit with appropriate code
  process.exit(failedTests > 0 ? 1 : 0);

} catch (error) {
  console.error('Fatal error running tests:', error);
  process.exit(1);
}
