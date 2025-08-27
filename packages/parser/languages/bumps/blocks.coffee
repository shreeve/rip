# Post-pass to attach IF/ELSE blocks using Line.depth and INDENT/OUTDENT tokens

attachBlocks = (program) ->
  return program unless program?.type is 'Program' and Array.isArray(program.lines)
  lines = program.lines
  i = 0
  while i < lines.length
    line = lines[i]
    i++
    continue unless line?.cmds?.length
    cmd = line.cmds[0]
    continue unless cmd?.type is 'If'
    base = line.depth or 0
    # then lines: strictly deeper than base until <= base or ELSE at same depth
    thenLines = []
    j = i
    while j < lines.length and ((lines[j].depth or 0) > base)
      thenLines.push lines[j]
      j++
    elseLines = []
    if j < lines.length and (lines[j].depth or 0) is base and lines[j]?.cmds?[0]?.type is 'Else'
      j++
      while j < lines.length and ((lines[j].depth or 0) > base)
        elseLines.push lines[j]
        j++
    cmd.then = thenLines if thenLines.length
    cmd.else = elseLines if elseLines.length
  program

module.exports = { attachBlocks }


