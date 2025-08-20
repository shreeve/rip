# Security Regex Tests - Rip Language Security Enhancement
# ----------------------------------------------------------
# Tests for the built-in security features that protect against newline injection attacks.
# Rip's regex operations automatically reject strings containing \n or \r by default,
# providing Ruby-style \A and \z boundary behavior for enhanced security.
#
# Key Security Features:
# - Default: Rejects strings with newlines (secure by default)
# - Override: Use /m flag to explicitly allow multiline input
# - Clean: Generated JavaScript remains readable and performant

test "=~ operator blocks newline injection by default", ->
  # Common injection attack patterns should be blocked
  malicious1 = "validuser\\n<script>alert('xss')</script>"
  malicious2 = "admin\\rmalicious"
  malicious3 = "user\\n\\rmore"

  # All should return null (blocked)
  eq (malicious1 =~ /^[a-z]+$/), null
  eq (malicious2 =~ /^[a-z]+$/), null
  eq (malicious3 =~ /^[a-z]+$/), null
  eq _, null

test "=~ operator allows valid single-line input", ->
  # Valid single-line input should work normally
  valid = "validuser"
  result = valid =~ /^([a-z]+)$/

  eq result[0], "validuser"
  eq result[1], "validuser"
  eq _[0], "validuser"
  eq _[1], "validuser"

test "=~ operator with /m flag allows multiline explicitly", ->
  # When /m flag is used, multiline should be allowed
  multiline = "line1\\nline2"
  result = multiline =~ /^line1.*line2$/m
  
  # Should match successfully (not null)
  ok result, "Multiline regex with /m flag should match"
  eq result[0], "line1\\nline2"
  eq _[0], "line1\\nline2"

test "regex indexing blocks newline injection by default", ->
  # Common injection patterns should be blocked in [] syntax too
  malicious1 = "validuser\\n<script>alert('xss')</script>"
  malicious2 = "admin\\rmalicious"

  # All should return null (blocked)
  eq malicious1[/^[a-z]+$/], null
  eq malicious2[/^[a-z]+$/], null
  eq _, null

test "regex indexing allows valid single-line input", ->
  # Valid single-line input should work normally
  valid = "validuser"
  result = valid[/^([a-z]+)$/]

  eq result, "validuser"
  eq _[0], "validuser"
  eq _[1], "validuser"

test "regex indexing with /m flag allows multiline explicitly", ->
  # When /m flag is used, multiline should be allowed
  multiline = "line1\\nline2"
  result = multiline[/^line1.*line2$/m]
  
  # Should match successfully (not null)
  ok result, "Multiline regex indexing with /m flag should match"
  eq result, "line1\\nline2"
  eq _[0], "line1\\nline2"

test "security works with capture groups", ->
  # Test that security works with complex patterns
  malicious = "user@domain.com\\n<script>"
  valid = "user@domain.com"
  
  # Malicious should be blocked (returns null) - test just the blocking
  eq (malicious =~ /^[a-z@.]+$/), null  # Simple pattern that should block newlines
  eq malicious[/^[a-z@.]+$/], null      # Same with indexing
  
  # Valid should work
  result = valid =~ /@(.+)$/
  ok result, "Valid email should match"
  eq result[1], "domain.com"
  eq _[1], "domain.com"

test "security compilation generates correct JavaScript", ->
  # Verify that security-enhanced regex compiles to correct JavaScript

  # Default (secure) - should not pass allowNewlines parameter
  compiled1 = CoffeeScript.compile("val =~ /test/", bare: yes).trim()
  ok compiled1.includes("toSearchable(val).match(/test/)"), "Should use secure toSearchable() call"
  ok not compiled1.includes("toSearchable(val, true)"), "Should not pass allowNewlines for secure regex"

  # Multiline (explicit) - should pass true for allowNewlines
  compiled2 = CoffeeScript.compile("val =~ /test/m", bare: yes).trim()
  ok compiled2.includes("toSearchable(val, true).match(/test/m)"), "Should pass allowNewlines=true for multiline regex"

test "security enhancement preserves clean JavaScript output", ->
  # Verify that the security enhancement doesn't make JavaScript verbose
  compiled = CoffeeScript.compile("username =~ /^[a-z]+$/", bare: yes).trim()

  # Should be clean and readable
  ok compiled.includes("toSearchable(username).match"), "Should use clean toSearchable pattern"
  ok not compiled.includes("compileMatchHelper"), "Should not use verbose helper functions"
  ok compiled.length < 1000, "Generated code should be reasonable (#{compiled.length} chars)"

test "real-world validation scenarios", ->
  # Test common validation patterns that should be secure
  
  # Email validation - block injection (use =~ instead of .match for security)
  eq ("user@domain.com\\n<script>" =~ /^[a-z@.]+$/), null  # Simplified pattern to avoid $ issues
  result = "user@domain.com"[/^([^@]+)@([^@]+)$/]
  ok result, "Valid email should match"
  eq _[1], "user"
  
  # Username validation - block injection  
  eq "admin\\nmalicious"[/^[a-zA-Z0-9_-]{3,20}$/], null
  eq "validuser"[/^[a-zA-Z0-9_-]{3,20}$/], "validuser"
  
  # IP validation - block injection
  eq "192.168.1.1\\nmalicious"[/^(?:\d{1,3}\.){3}\d{1,3}$/], null
  eq "192.168.1.1"[/^(?:\d{1,3}\.){3}\d{1,3}$/], "192.168.1.1"
