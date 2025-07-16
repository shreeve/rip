# Timing Formatter - Unicode Box Tables for Parser Statistics

A beautiful, consistent way to display parser generation timing and statistics using Unicode box drawing characters and ANSI colors.

## Problem Solved

Previously, timing output was inconsistent:
- **Symbols**: showed "user" values
- **Terminals**: showed "total" values
- **Nonterminals**: showed "total" values

This created confusion about what was being measured. The timing formatter solves this by:
- ✅ **Consistent columns**: Always shows both User and Total values
- ✅ **Beautiful formatting**: Unicode box tables with ANSI colors
- ✅ **Flexible notes**: Additional context in a dedicated column
- ✅ **Smart formatting**: Automatic color coding for times, counts, and percentages

## Quick Start

```coffee
{formatTimingTable} = require './timing-formatter'

# Your timing data
data =
  'Grammar Analysis':
    'symbols':
      user: 42          # User-defined symbols
      total: 89         # Total symbols (including generated)
      notes: 'user vs generated'
      userType: 'count'
      totalType: 'count'
    'terminals':
      user: 156         # User-defined terminals
      total: 203        # Total terminals (including generated)
      notes: '77% user-defined'
      userType: 'count'
      totalType: 'count'

# Display the table
console.log formatTimingTable(data, {
  title: 'Parser Generation Statistics'
  showColors: true
})
```

## Output Example

```
                          Parser Generation Statistics

┌──────────────┬──────────────────┬──────────────┬──────────────┬───────────────────────┐
│ Section      │ Metric           │     User     │    Total     │ Notes                 │
├──────────────┼──────────────────┼──────────────┼──────────────┼───────────────────────┤
│ Grammar      │ symbols          │      42      │      89      │ user vs generated     │
│              │ terminals        │     156      │     203      │ 77% user-defined      │
│              │ nonterminals     │      67      │      67      │ all user-defined      │
├──────────────┼──────────────────┼──────────────┼──────────────┼───────────────────────┤
│ Performance  │ parse time       │     1.3s     │     1.3s     │ 93% efficiency        │
│              │ memory           │  45,600,000  │  52,300,000  │ 87% efficiency        │
└──────────────┴──────────────────┴──────────────┴──────────────┴───────────────────────┘
```

## Data Format

Each metric requires this structure:

```coffee
'section_name':
  'metric_name':
    user: 42              # User/actual value
    total: 89             # Total/theoretical value
    notes: 'description'  # Optional notes
    userType: 'count'     # 'time' or 'count'
    totalType: 'count'    # 'time' or 'count'
    notesType: 'text'     # 'text', 'percent', or 'diff'
```

## Value Types

### userType / totalType
- **`'time'`**: Values in milliseconds, formatted as `123ms` or `1.2s`
- **`'count'`**: Numeric values, formatted with commas: `1,234`

### notesType
- **`'text'`**: Plain text
- **`'percent'`**: Percentage values with color coding
- **`'diff'`**: Difference values with +/- and color coding

## Color Coding

### Time Values
- 🟢 **Green**: < 1 second
- 🟡 **Yellow**: 1-5 seconds
- 🔴 **Red**: > 5 seconds

### Count Values
- 🔵 **Cyan**: All numeric values

### Percentages
- 🟢 **Green**: < 50%
- 🟡 **Yellow**: 50-80%
- 🔴 **Red**: > 80%

## Integration with TimingCollector

For automatic timing collection:

```coffee
{TimingCollector} = require './parser-with-timing'

timing = new TimingCollector()

# Start a section
timing.section 'Grammar Analysis'

# Add metrics with both user and total values
timing.addMetric 'symbols', userCount, totalCount, 'user-defined vs total'

# Time-based metrics
timing.start 'processGrammar'
# ... do work ...
timing.end 'processGrammar', null, null, 'grammar preprocessing'

# Display results
console.log formatTimingTable(timing.getResults())
```

## Configuration Options

```coffee
options = {
  title: 'Custom Title'           # Table title
  showColors: true                # Enable ANSI colors
  showHeader: true                # Show column headers
  columnWidths: {                 # Minimum column widths
    section: 12
    metric: 16
    user: 12
    total: 12
    notes: 20
  }
}
```

## Files

- **`timing-formatter.coffee`**: Core formatting functions
- **`timing-example.coffee`**: Usage examples and demos
- **`parser-with-timing.coffee`**: Integration with parser generation
- **`README-timing-formatter.md`**: This documentation

## Usage in Parser Generation

Replace your existing timing output with:

```coffee
# Before: Inconsistent output
console.log "symbols: #{userSymbols}"      # Only user value
console.log "terminals: #{totalTerminals}" # Only total value

# After: Consistent table
timing.section 'Grammar Analysis'
timing.addMetric 'symbols', userSymbols, totalSymbols, 'user vs total'
timing.addMetric 'terminals', userTerminals, totalTerminals, "#{coverage}% user-defined"
console.log formatTimingTable(timing.getResults())
```

This provides a much clearer, more professional display of your parser generation statistics with consistent user/total value presentation.