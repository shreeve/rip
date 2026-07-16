<img src="https://raw.githubusercontent.com/shreeve/rip-lang/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip RSX - @rip-lang/rsx

> **Rip Style XML — XML ⇄ Rip object, with security defaults that match what you want for SOAP and EDI envelopes.**

RSX is a small, forgiving XML parser and serializer for the cases where
you want a Rip object, not a DOM. It is built around a real
scanner/tokenizer instead of nested regular expressions, with security
defaults appropriate for talking to outside systems.

**Runtime:** browser-safe (`rip.browser: true`). One `.rip` file.

## Quick Start

```bash
bun add @rip-lang/rsx
```

```coffee
import { parse, stringify } from '@rip-lang/rsx'

obj = parse soapXml
obj.Envelope.Body.COREEnvelopeRealTimeRequest.Payload  # → X12 string

xml = stringify 'soapenv:Envelope', responseObj,
  indent: 2
  cdata: ['Payload']
```

## Features

- A **plain Rip object tree** where repeated child tags collapse into arrays automatically
- **Namespace prefixes stripped by default** for ergonomic consumer code, with an opt-in mode to preserve them
- **CDATA content preserved verbatim** — never collapses whitespace inside, never escapes characters
- **No XXE, no entity-expansion attacks** — DOCTYPE rejected by default, only the five built-in entities decoded, custom `<!ENTITY>` declarations ignored
- **Hard size cap** (5 MB by default) so a hostile peer can't OOM you with a giant payload
- Positioned errors — every rejection is an `RsxError` carrying the scan `offset`

## Parsing

```coffee
doc = parse '<order id="7"><item>a</item><item>b</item></order>'
# { order: { '@attrs': { id: '7' }, item: ['a', 'b'] } }

# Force single-occurrence tags into arrays (array, Set, or predicate)
parse xml, forceArray: ['item']

# Preserve namespace prefixes verbatim
parse xml, stripNamespaces: false

# Keep text verbatim instead of collapsing whitespace
parse xml, trimText: false
```

| Option | Default | Notes |
|---|---|---|
| `stripNamespaces` | `true` | `'ns1:Foo'` → `'Foo'` |
| `preserveCDATA` | `true` | CDATA text is verbatim |
| `trimText` | `true` | Collapse whitespace in non-CDATA text |
| `coerceNumbers` | `false` | Never auto-coerce numbers — text stays text |
| `coerceBooleans` | `false` | Never auto-coerce booleans |
| `attrsKey` | `'@attrs'` | Grouped attribute key on each node |
| `textKey` | `'#text'` | Mixed-content text key |
| `forceArray` | `null` | Set, array, or function — force these tags to arrays |
| `preserveChildren` | `false` | Emit `@children` in document order |
| `allowDoctype` | `false` | DOCTYPE rejected by default |
| `allowProcessingInstructions` | `true` | Tolerate `<?xml ...?>` by skipping |
| `maxBytes` | `5 * 1024 * 1024` | Hard cap |

## Object Shape

```xml
<list>
  <item count="2">a</item>
  <item count="3">b</item>
</list>
```

becomes

```coffee
{
  list:
    item: [
      { '@attrs': { count: '2' }, '#text': 'a' }
      { '@attrs': { count: '3' }, '#text': 'b' }
    ]
}
```

Elements with no attributes and only text collapse to scalars
(`<a>x</a>` → `{ a: 'x' }`); repeated sibling tags collapse into
arrays; empty and self-closing elements become `''`.

## Stringifying

```coffee
stringify 'a', { b: '1', c: '2' }          # <a><b>1</b><c>2</c></a>
stringify 'l', { i: ['a', 'b'] }           # <l><i>a</i><i>b</i></l>
stringify 'a', { '@attrs': { id: '1' } }   # <a id="1"/>

# Pretty-print with indentation
stringify 'a', { b: { c: 'x' } }, indent: 2

# Wrap listed tags' content in CDATA
stringify 'a', { p: 'raw <x> & y' }, cdata: ['p']
# <a><p><![CDATA[raw <x> & y]]></p></a>
```

| Option | Default | Notes |
|---|---|---|
| `indent` | `''` | String or number of spaces |
| `newline` | implicit | Newline character (defaults based on indent) |
| `cdata` | `null` | Set or array of tag names whose content should be CDATA-wrapped |
| `attrsKey`, `textKey` | match parse defaults | |

## API Summary

```coffee
parse(xml, opts?)               # XML string → Rip object
stringify(rootName, obj, opts?) # Rip object → XML string
RsxError                        # Error subclass with .offset
```

## Design Notes

RSX deliberately does NOT:

- Validate against a schema or DTD
- Honor `xmlns` binding semantics — namespace prefixes are opaque labels
- Round-trip mixed content (text and elements interleaved) unless you opt in via `preserveChildren: true`
- Coerce text to numbers or booleans — text stays text, always

## Test

```bash
bun run test
```

The suite pins tree shape, entities, CDATA, security defaults (DOCTYPE,
XXE, size caps), namespaces, attribute forms, stringify escaping and
indentation, and SOAP-envelope round trips.
