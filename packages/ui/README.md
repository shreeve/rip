# @rip-lang/ui

First-party UI infrastructure for Rip.

The package is organized by ownership:

- `email/` — synchronous server-side email DOM, rendering, and components
- `shared/` — utilities genuinely shared by browser and email surfaces
- `tailwind/` — the sole boundary for Tailwind compilation and CSS parsing

Public APIs use named exports. Package dependencies are isolated here;
the Rip compiler root remains dependency- and workspace-free.

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

## Test

```sh
bun run test
```

Root battery rows exercise package/compiler/runtime integration.
