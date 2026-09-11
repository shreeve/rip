<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip UI

> **First-party UI infrastructure — email components, shared utilities, and Tailwind compilation.**

Named-export surfaces for browser and email UI. Ownership is split so each
boundary stays clear:

- `email/` — synchronous server-side email DOM, rendering, and components
- `shared/` — utilities genuinely shared by browser and email surfaces
- `tailwind/` — the sole boundary for Tailwind compilation and CSS parsing

**Runtime:** email rendering is server-side (Bun); `browser/` and `shared/`
are for browser consumers. Dependency budget is `css-tree` and `tailwindcss`
(exact pins in this package's `package.json`; the repo-root `bun.lock` owns
resolution under the hoisted workspace). The Rip compiler itself remains
dependency-free.

## Email

Applications import the component catalog and renderers from the single public
entry point:

```coffee
import {
  toHTML
  Email, Head, Body, Preview, Container
  Heading, Text, Link, Divider
} from 'rip/ui/email'

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

`rip/ui/email/dom`, `/compat`, and `/render` expose focused substrate
APIs for framework and tooling code. Application email templates should use
`rip/ui/email`.

Email rendering is synchronous. The default Tailwind configuration is prepared
when the package loads. Prepare a custom configuration once before passing the
same object to `Tailwind`:

```coffee
import { prepareConfig } from 'rip/ui/tailwind'
import { Tailwind, Text, toHTML } from 'rip/ui/email'

config = theme: extend: colors: brand: '#123456'
prepareConfig! config

BrandedEmail = component
  render
    Tailwind config: config
      Text class: 'text-brand', 'Prepared once, rendered synchronously.'

html = toHTML BrandedEmail
```

## Preview and export (`rip email`)

`rip email` is the package's CLI, the counterpart of react-email's
`email dev`. A template is a `.rip` file under a directory that exports
one component; its address is the file path without the extension. The
directory defaults to `./emails`, or to the current directory when that
is itself named `emails`; it is never the bare current directory, since
from a project root that would import every `.rip` file in the tree.

```bash
rip email dev api/emails                       # live preview at https://email.local/
rip email dev api/emails --open                # --open launches the browser
rip email dev api/emails --host mail.local     # another name, if email.local is taken (.local, .via.rip, or .localhost)
rip email export api/emails --out out --text   # out/<file>.html and .txt
```

`dev` runs the preview as a Rip Site under the edge, so Janus must be
running, as it is wherever a Rip app is served. The launcher writes a
transient project whose app is this package's page and whose entry is
this package's API, runs the Sites manager on it in the foreground, and
removes the project when the manager exits.

A file led by an underscore is shared by templates and is not one:
`_layout.rip` holds the layout and the vocabulary the emails are written
in, the same convention the app router uses for its layouts.

The preview page lists every template, shows it as an inbox row above
the rendered message at desktop or mobile width, in light or a forcing
client's dark mode, and can show the plain-text twin or the raw HTML. A
save under the template directory refetches the page in place; an edit
to the page's own source hot-reloads through the manager.

`subject` and `from` statics, functions of the same props, give the
message's subject line and its sender's name; the preview shows them in
an inbox row, and an application's mailer can read them so the envelope
and the body never disagree:

```coffee
SignInCode.subject = (props) -> "Use code #{props.code} to sign in"
SignInCode.from    = -> 'MedLabs'
```

A `previewProps` static on the component supplies the props previews
and exports render with; without one the component's defaults apply:

```coffee
export SignInCode = component
  @code: string := ''
  render
    ...

SignInCode.previewProps = code: '482913'
```

Every catalog and render runs in a fresh child process, so a save is
seen whole — edits to modules a template imports included — and a
template that throws shows its error in place of the frame. The bin is
`email/cli.rip` itself (`rip-email`); `rip email` reaches it from any
directory.

## Test

```sh
bun run test
```

Root battery rows exercise package/compiler/runtime integration.
