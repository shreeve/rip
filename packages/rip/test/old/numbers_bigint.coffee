# BigInt Literals
# ---------------

test 'BigInt exists', 'typeof BigInt', 'function'

test 'decimal BigInt literal', '42n', 42n

test 'decimal BigInt with separator', '1_000n', 1000n

test 'binary BigInt literal', '0b101010n', 42n

test 'octal BigInt literal', '0o52n', 42n

test 'hexadecimal BigInt literal', '0x2an', 42n
