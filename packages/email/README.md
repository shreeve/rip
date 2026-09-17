<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Email

> **Email templates as components, rendered to HTML and a text twin on the server.**

A template is an ordinary `component`. `toEmail` mounts it once against a server DOM subset, serializes the tree, and walks it again for the plain-text twin; the compiled output's `document` is swapped in for that one render and restored after, so nothing about the component knows it is not in a browser.

**Runtime:** not browser-safe — rendering installs a server DOM on the global for the duration of a synchronous render, and the CLI spawns processes and watches files. The library is three `.rip` files, `email.rip` (the surface), `dom.rip` (the DOM subset), and `render.rip` (the host); `cli.rip` and `preview/` are the CLI.

## Quick Start

```coffee
import { toEmail, Email, Head, Body, Preview, Container, Heading, Text, Link } from 'rip/email'

Welcome = component
  @name: string := 'friend'
  render
    Email
      Head
      Body style: { background: '#fafafa', padding: '40px 20px' }
        Preview text: "Welcome, #{@name}"
        Container
          Heading "Welcome, #{@name}!"
          Text 'Thanks for joining.'
          Link href: 'https://example.com', 'Get started'

{ html, text, preview } = toEmail Welcome, name: 'Ada'
```

`html` is the message, `text` its plain-text twin, and `preview` the inbox line the `Preview` part rendered, or `null` when the template renders none.

## Components

Every part takes `class` and `style`, and renders native tags the way email clients read them:

- `Email` — the `<html>` element (`lang`, `dir`).
- `Head` — the `<head>` with the charset and Apple reformatting meta tags.
- `Body` — the `<body>` around a full-width presentation table. The body element carries the style's background with a zeroed margin so the ground fills the viewport; the rest of the style lands on the cell.
- `Preview` — the hidden inbox preview line (`text`), padded to its full length.
- `Container` — a centered table at a `37.5em` maximum width.
- `Section` — a full-width table.
- `Heading` — `h1` through `h6` by `as`.
- `Text` — a `<p>` with email-safe defaults.
- `Link` — an `<a>`, `target="_blank"` by default. An `href` fails closed: `http`, `https`, `mailto`, `tel`, and relative addresses pass; every other scheme, control characters, and protocol-relative addresses render as `#`.

Padding on `Container` and `Section` moves onto the table cell, since Outlook and Klaviyo drop it on a table and honor it on a `td`.

## Styles

`style` takes a string or an object. The object type is `CSSProperties` from `rip/app`, re-exported here: the same type the compiler gives a native tag's `style`, lib.dom's declaration vocabulary, camelCased, plus `--custom` keys. Values are written as given, so a number is admitted only on the unitless properties (`fontWeight`, `lineHeight`, `opacity`, …) and as `0` anywhere. A template can pass a `CSSProperties` value straight to a native tag.

```coffee
import type { CSSProperties } from 'rip/email'

muted: CSSProperties = { color: '#525252', fontSize: '14px', lineHeight: '20px' }
```

## The text twin

Block elements and headings become line breaks, a link keeps its address beside its text, an image contributes its `alt`, and an element marked `data-skip-in-text="true"` contributes nothing.

## CLI

`rip email` previews and exports the templates in a directory (`./emails` by default, or the current directory when it is itself named `emails`). A template file exports one component; a file led by an underscore is shared by templates and is not one. `Component.previewProps` chooses the props it renders with and `Component.subject`, a function of the props, gives the subject line.

```bash
rip email dev            # live preview at https://email.local/ under the edge
rip email export --text  # <out>/<file>.html and .txt per template
```

The preview renders every template in a fresh process, so a save is seen whole, and offers the HTML, the text twin, the source, a mobile width, and a dark-mode simulation of Gmail's color inversion.

## Test

```bash
bun run test
```

The suite covers the DOM subset, the render host's global swap and restore, the component rules above, and the CLI end to end as a subprocess.
