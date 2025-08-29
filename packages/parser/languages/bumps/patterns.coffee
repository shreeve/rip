# MUMPS pattern parser (CoffeeScript)
# Supports counts n / n.m, class sets, strings with doubled quotes, groups, and sequences

parsePattern = (input) ->
  s = String(input or '')
  i = 0

  eof = -> i >= s.length
  peek = -> s[i]
  next = -> s[i++]
  isDigit = (ch) -> ch >= '0' and ch <= '9'

  readNumber = ->
    start = i
    i++ while not eof() and isDigit(peek())
    Number s.slice(start, i)

  readString = ->
    v = ''
    next() # opening quote
    while not eof()
      ch = next()
      if ch is '"'
        # doubled quotes inside strings => literal quote
        if not eof() and peek() is '"'
          next()
          v += '"'
          continue
        break
      if ch is '\\' and not eof()
        v += next()
      else
        v += ch
    v

  parseCount = ->
    return null unless isDigit(peek())
    min = readNumber()
    if peek() is '.'
      next()
      max = readNumber()
      return {min, max}
    {min, max: min}

  applyCount = (node, count) -> if not count then node else Object.assign {}, node, {min: count.min, max: count.max}

  parseAtom = ->
    count = parseCount()
    return null if eof()
    ch = peek()
    if ch is '"'
      str = readString()
      return applyCount {type:'String', value:str}, count
    if ch is '('
      next()
      items = []
      while not eof() and peek() isnt ')'
        if peek() is ',' then next(); continue
        a = parseAtom()
        if a then items.push a else break
      next() if peek() is ')'
      return applyCount {type:'Group', items}, count
    if /^[A-Za-z]$/.test ch
      CLASS_CANON = { A:'ALPHA', N:'NUM', L:'LOWER', U:'UPPER', P:'PUNCT', B:'BLANK', S:'SPACE', C:'CONTROL', D:'DIGIT', X:'HEXDIGIT', V:'VOWEL', Z:'GRAPH' }
      # read contiguous class letters, e.g., AN, ALU, etc.
      names = ''
      while not eof() and /^[A-Za-z]$/.test(peek()) then names += next()
      names = names.toUpperCase()
      if names.length is 1
        nm = names
        return applyCount {type:'Class', name:nm, canonical: CLASS_CANON[nm] or nm}, count
      arr = names.split ''
      return applyCount {type:'ClassSet', names: arr, canonicals: arr.map (n)-> CLASS_CANON[n] or n}, count
    next()
    applyCount {type:'Char', value: ch}, count

  parseSeq = ->
    items = []
    while not eof()
      a = parseAtom()
      if a then items.push a else break
    {type:'PatternSeq', items}

  parseSeq()

module.exports = { parsePattern }
