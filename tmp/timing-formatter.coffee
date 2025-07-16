#!/usr/bin/env coffee

# Timing Formatter - Creates beautiful Unicode box tables for timing data
# Usage: formatTimingTable(data, options)

# ANSI color codes
colors =
  reset: '\x1b[0m'
  bold: '\x1b[1m'
  dim: '\x1b[2m'
  red: '\x1b[31m'
  green: '\x1b[32m'
  yellow: '\x1b[33m'
  blue: '\x1b[34m'
  magenta: '\x1b[35m'
  cyan: '\x1b[36m'
  white: '\x1b[37m'
  brightBlue: '\x1b[94m'
  brightGreen: '\x1b[92m'
  brightYellow: '\x1b[93m'

# Unicode box drawing characters
box =
  topLeft: '┌'
  topRight: '┐'
  bottomLeft: '└'
  bottomRight: '┘'
  horizontal: '─'
  vertical: '│'
  cross: '┼'
  teeDown: '┬'
  teeUp: '┴'
  teeRight: '├'
  teeLeft: '┤'

# Get visible length of string (excluding ANSI codes)
visibleLength = (str) ->
  str.replace(/\x1b\[[0-9;]*m/g, '').length

# Helper function to pad string to specific width
pad = (str, width, align = 'left') ->
  str = String(str)
  visibleLen = visibleLength(str)

  if visibleLen >= width
    return str

  padding = ' '.repeat(width - visibleLen)
  switch align
    when 'center'
      leftPad = Math.floor(padding.length / 2)
      rightPad = padding.length - leftPad
      ' '.repeat(leftPad) + str + ' '.repeat(rightPad)
    when 'right'
      padding + str
    else
      str + padding

# Format timing value with appropriate color
formatTiming = (value, type = 'time') ->
  if typeof value is 'number'
    if type is 'time'
      if value < 1000
        "#{colors.green}#{value}ms#{colors.reset}"
      else if value < 5000
        "#{colors.yellow}#{(value/1000).toFixed(1)}s#{colors.reset}"
      else
        "#{colors.red}#{(value/1000).toFixed(1)}s#{colors.reset}"
    else
      "#{colors.cyan}#{value.toLocaleString()}#{colors.reset}"
  else
    "#{colors.dim}#{value}#{colors.reset}"

# Format percentage or difference
formatExtra = (value, type = 'percent') ->
  if typeof value is 'number'
    if type is 'percent'
      color = if value > 80 then colors.red else if value > 50 then colors.yellow else colors.green
      "#{color}#{value.toFixed(1)}%#{colors.reset}"
    else if type is 'diff'
      color = if value > 0 then colors.red else colors.green
      sign = if value > 0 then '+' else ''
      "#{color}#{sign}#{value}#{colors.reset}"
    else
      "#{colors.dim}#{value}#{colors.reset}"
  else
    "#{colors.dim}#{value || ''}#{colors.reset}"

# Create timing table
formatTimingTable = (data, options = {}) ->
  # Default options
  opts = Object.assign {
    title: 'Timing Statistics'
    showColors: true
    showHeader: true
    columnWidths:
      section: 12
      metric: 16
      user: 12
      total: 12
      notes: 20
  }, options

  # Disable colors if requested
  if not opts.showColors
    for key of colors
      colors[key] = ''

  # Calculate actual column widths based on data
  maxWidths =
    section: Math.max(opts.columnWidths.section, 'Section'.length)
    metric: Math.max(opts.columnWidths.metric, 'Metric'.length)
    user: Math.max(opts.columnWidths.user, 'User'.length)
    total: Math.max(opts.columnWidths.total, 'Total'.length)
    notes: Math.max(opts.columnWidths.notes, 'Notes'.length)

  # Update widths based on data content
  for section of data
    maxWidths.section = Math.max(maxWidths.section, section.length)
    for metric of data[section]
      maxWidths.metric = Math.max(maxWidths.metric, metric.length)
      item = data[section][metric]
      if item.user?
        userFormatted = formatTiming(item.user, item.userType || 'time')
        maxWidths.user = Math.max(maxWidths.user, visibleLength(userFormatted))
      if item.total?
        totalFormatted = formatTiming(item.total, item.totalType || 'time')
        maxWidths.total = Math.max(maxWidths.total, visibleLength(totalFormatted))
      if item.notes?
        notesFormatted = formatExtra(item.notes, item.notesType || 'text')
        maxWidths.notes = Math.max(maxWidths.notes, visibleLength(notesFormatted))

  # Build table
  lines = []
  totalWidth = maxWidths.section + maxWidths.metric + maxWidths.user + maxWidths.total + maxWidths.notes + 8 # +8 for separators

  # Title
  if opts.showHeader
    titleLine = "#{colors.bold}#{colors.brightBlue}#{pad(opts.title, totalWidth, 'center')}#{colors.reset}"
    lines.push titleLine
    lines.push ''

  # Top border
  topBorder = box.topLeft +
    box.horizontal.repeat(maxWidths.section + 2) + box.teeDown +
    box.horizontal.repeat(maxWidths.metric + 2) + box.teeDown +
    box.horizontal.repeat(maxWidths.user + 2) + box.teeDown +
    box.horizontal.repeat(maxWidths.total + 2) + box.teeDown +
    box.horizontal.repeat(maxWidths.notes + 2) + box.topRight
  lines.push topBorder

  # Header row
  headerRow = box.vertical +
    " #{colors.bold}#{colors.brightYellow}#{pad('Section', maxWidths.section)}#{colors.reset} " + box.vertical +
    " #{colors.bold}#{colors.brightYellow}#{pad('Metric', maxWidths.metric)}#{colors.reset} " + box.vertical +
    " #{colors.bold}#{colors.brightYellow}#{pad('User', maxWidths.user, 'center')}#{colors.reset} " + box.vertical +
    " #{colors.bold}#{colors.brightYellow}#{pad('Total', maxWidths.total, 'center')}#{colors.reset} " + box.vertical +
    " #{colors.bold}#{colors.brightYellow}#{pad('Notes', maxWidths.notes)}#{colors.reset} " + box.vertical
  lines.push headerRow

  # Header separator
  headerSep = box.teeRight +
    box.horizontal.repeat(maxWidths.section + 2) + box.cross +
    box.horizontal.repeat(maxWidths.metric + 2) + box.cross +
    box.horizontal.repeat(maxWidths.user + 2) + box.cross +
    box.horizontal.repeat(maxWidths.total + 2) + box.cross +
    box.horizontal.repeat(maxWidths.notes + 2) + box.teeLeft
  lines.push headerSep

  # Data rows
  sectionNames = Object.keys(data).sort()
  for section, sectionIndex in sectionNames
    sectionData = data[section]
    metricNames = Object.keys(sectionData).sort()

    for metric, metricIndex in metricNames
      item = sectionData[metric]

      # Section name (only show on first metric of section)
      sectionName = if metricIndex is 0 then section else ''
      sectionCell = if sectionName
        "#{colors.bold}#{colors.brightGreen}#{pad(sectionName, maxWidths.section)}#{colors.reset}"
      else
        pad('', maxWidths.section)

      # Metric name
      metricCell = "#{colors.brightBlue}#{pad(metric, maxWidths.metric)}#{colors.reset}"

      # User value
      userValue = if item.user?
        formatTiming(item.user, item.userType || 'time')
      else
        '—'
      userCell = pad(userValue, maxWidths.user, 'center')

      # Total value
      totalValue = if item.total?
        formatTiming(item.total, item.totalType || 'time')
      else
        '—'
      totalCell = pad(totalValue, maxWidths.total, 'center')

      # Notes
      notesCell = if item.notes?
        formatExtra(item.notes, item.notesType || 'text')
      else
        pad('', maxWidths.notes)

            # Build row
      row = box.vertical +
        " #{sectionCell} " + box.vertical +
        " #{metricCell} " + box.vertical +
        " #{userCell} " + box.vertical +
        " #{totalCell} " + box.vertical +
        " #{notesCell} " + box.vertical
      lines.push row

    # Add section separator (except for last section)
    if sectionIndex < sectionNames.length - 1
      sectionSep = box.teeRight +
        box.horizontal.repeat(maxWidths.section + 2) + box.cross +
        box.horizontal.repeat(maxWidths.metric + 2) + box.cross +
        box.horizontal.repeat(maxWidths.user + 2) + box.cross +
        box.horizontal.repeat(maxWidths.total + 2) + box.cross +
        box.horizontal.repeat(maxWidths.notes + 2) + box.teeLeft
      lines.push sectionSep

  # Bottom border
  bottomBorder = box.bottomLeft +
    box.horizontal.repeat(maxWidths.section + 2) + box.teeUp +
    box.horizontal.repeat(maxWidths.metric + 2) + box.teeUp +
    box.horizontal.repeat(maxWidths.user + 2) + box.teeUp +
    box.horizontal.repeat(maxWidths.total + 2) + box.teeUp +
    box.horizontal.repeat(maxWidths.notes + 2) + box.bottomRight
  lines.push bottomBorder

  lines.join('\n')

# Example usage and demo
if require.main is module
  # Sample data showing the inconsistency you mentioned
  sampleData =
    'Grammar':
      'symbols':
        user: 42          # Shows user value
        total: 89         # Should also show total
        notes: 'user-defined vs total'
        userType: 'count'
        totalType: 'count'
        notesType: 'text'
      'terminals':
        user: 156         # Currently missing - shows total instead
        total: 203        # Shows total value
        notes: '77% coverage'
        userType: 'count'
        totalType: 'count'
        notesType: 'percent'
      'nonterminals':
        user: 67          # Currently missing - shows total instead
        total: 67         # Shows total value
        notes: 'all defined'
        userType: 'count'
        totalType: 'count'
        notesType: 'text'

    'Performance':
      'parse time':
        user: 1250        # User CPU time
        total: 1340       # Total elapsed time
        notes: '93% efficiency'
        userType: 'time'
        totalType: 'time'
        notesType: 'percent'
      'memory':
        user: 45600000    # User memory
        total: 52300000   # Total memory
        notes: '87% efficiency'
        userType: 'count'
        totalType: 'count'
        notesType: 'percent'
      'gc time':
        user: 89          # GC user time
        total: 95         # GC total time
        notes: '6% overhead'
        userType: 'time'
        totalType: 'time'
        notesType: 'percent'

  console.log formatTimingTable(sampleData, {
    title: 'Parser Generation Statistics'
    showColors: true
  })

  console.log '\n' + formatTimingTable(sampleData, {
    title: 'Parser Generation Statistics (No Colors)'
    showColors: false
  })

# Export for use in other modules
module.exports = { formatTimingTable, formatTiming, formatExtra, colors, box }