# @rip-lang/ui

First-party UI infrastructure for Rip.

The package is organized by ownership:

- `email/` — synchronous server-side email DOM, rendering, and components
- `shared/` — utilities genuinely shared by browser and email surfaces
- `tailwind/` — the sole boundary for Tailwind compilation and CSS parsing

Public APIs use named exports. This package's dependency budget
(`css-tree`, `tailwindcss` — exact pins) lives in its `package.json`;
the repo-root `bun.lock` owns resolution under the hoisted workspace.
The Rip compiler itself remains dependency-free.

## Email

Applications import the component catalog and renderers from the single public
entry point:

```coffee
import {
  toHTML
  Email, Head, Body, Preview, Container
  Heading, Text, Link, Divider
} from '@rip-lang/ui/email'

WelcomeEmail = component
  @name =! 'World'
  render
    Email
      Head
      Preview text: 'Welcome aboard'
      Body
        Container
          Heading "Welcome, #{@name}!"
          Text 'Thanks for signing up.'
          Link href: 'https://example.com'
            'Get started'
          Divider
          Text 'See you soon.'

html = toHTML WelcomeEmail, name: 'Alice'
```

`@rip-lang/ui/email/dom`, `/compat`, and `/render` expose focused substrate
APIs for framework and tooling code. Application email templates should use
`@rip-lang/ui/email`.

Email rendering is synchronous. The default Tailwind configuration is prepared
when the package loads. Prepare a custom configuration once before passing the
same object to `Tailwind`:

```coffee
import { prepareConfig } from '@rip-lang/ui/tailwind'
import { Tailwind, Text, toHTML } from '@rip-lang/ui/email'

config = theme: extend: colors: brand: '#123456'
prepareConfig! config

BrandedEmail = component
  render
    Tailwind config: config
      Text class: 'text-brand', 'Prepared once, rendered synchronously.'

html = toHTML BrandedEmail
```

## Test

```sh
bun run test
```

Root battery rows exercise package/compiler/runtime integration.
