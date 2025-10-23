# JavaScript Literals
# -------------------

# Basic inline JavaScript
test 'inline JavaScript evaluation', """
  `var x = 5`
  x
""", 5

# Block inline JavaScript
test 'block inline JavaScript', """
  ```
  var a = 1;
  var b = 2;
  ```
  c = 3
  a + b + c
""", 6

test 'block JavaScript with single line', """
  ```var d = 4;```
  d
""", 4

# Multiple variables in JavaScript block
test 'multiple JS variables', """
  ```
  var a = 10;
  var b = 20;
  var c = 30;
  ```
  a + b + c
""", 60

# JavaScript blocks with CoffeeScript
test 'JS blocks mixed with CS', """
  x = 1
  ```
  var y = 2;
  ```
  z = 3
  x + y + z
""", 6

# Inline JavaScript returning value
test 'inline JS with return value', """
  result = `(function() { return 42; })()`
  result
""", 42
