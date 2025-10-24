# Slicing and Splicing
# --------------------

# Basic slicing
test 'basic inclusive slice', '[0,1,2,3,4,5][2..4]', [2,3,4]
test 'basic exclusive slice', '[0,1,2,3,4,5][2...4]', [2,3]
test 'slice from end', '[0,1,2,3,4,5][3..5]', [3,4,5]

# Slicing with variables
test 'slice with variables', """
  arr = [0,1,2,3,4,5]
  a = 1
  b = 4
  arr[a..b]
""", [1,2,3,4]

test 'exclusive slice with variables', """
  arr = [0,1,2,3,4,5]
  a = 1
  b = 4
  arr[a...b]
""", [1,2,3]

# Unbounded slicing
test 'slice from index to end', '[0,1,2,3,4,5][3..]', [3,4,5]
test 'slice from beginning to index', '[0,1,2,3,4,5][...3]', [0,1,2]
test 'slice from negative index', '[0,1,2,3,4,5][-2..]', [4,5]
test 'slice to negative index', '[0,1,2,3,4,5][..-1]', [0,1,2,3,4,5]
test 'slice entire array', '[0,1,2,3,4,5][..]', [0,1,2,3,4,5]

# String slicing
test 'string inclusive slice', '"abcdef"[1..3]', "bcd"
test 'string exclusive slice', '"abcdef"[1...3]', "bc"
test 'string from index', '"abcdef"[3..]', "def"
test 'string to index', '"abcdef"[...3]', "abc"
test 'string negative index', '"abcdef"[-2..]', "ef"

# Empty slices
test 'empty slice same index', '[0,1,2,3,4,5][2...2]', []
test 'single element slice', '[0,1,2,3,4,5][2..2]', [2]

# Splicing
test 'basic splice', """
  arr = [0,1,2,3,4,5]
  arr[2..4] = ['a', 'b', 'c']
  arr
""", [0,1,'a','b','c',5]

test 'splice with single element', """
  arr = [0,1,2,3,4,5]
  arr[2..2] = 'x'
  arr
""", [0,1,'x',3,4,5]

test 'splice deletion', """
  arr = [0,1,2,3,4,5]
  arr[2..4] = []
  arr
""", [0,1,5]

test 'splice at beginning', """
  arr = [0,1,2,3,4,5]
  arr[...2] = ['a', 'b']
  arr
""", ['a','b',2,3,4,5]

test 'splice at end', """
  arr = [0,1,2,3,4,5]
  arr[4..] = ['x', 'y', 'z']
  arr
""", [0,1,2,3,'x','y','z']

# Splice with expressions
test 'splice with expression indices', """
  arr = [0,1,2,3,4,5]
  i = 1
  j = 3
  arr[i+1..j+1] = ['new']
  arr
""", [0,1,'new',5]

# String splice (should create new string)
test 'string replacement', """
  str = "hello"
  str = str[...2] + 'y' + str[3..]
  str
""", "heylo"
