# Rip RFCs

Design proposals under discussion. The **Tags** column groups by area (`type-system` · `runtime` · `compiler` · `packaging` · `data`), labels rather than partitions, so a cross-cutting RFC carries several.

|    # | RFC                                                                                  | Tags                   | Status      |
| ---: | ------------------------------------------------------------------------------------ | ---------------------- | ----------- |
|    1 | [Split `rip/ui` into headless components and `rip/email`](#rfc-1-split-ripui-into-headless-components-and-ripemail) | `packaging`, `runtime` | 🟡 Proposed |

---

## RFC 1: Split `rip/ui` into headless components and `rip/email`

> **Status: Proposed.**

`packages/ui` is rewritten from scratch, in one change, as two packages. `rip/ui`, still under `packages/ui`, is headless compound components, opening with `Dialog`, a demo route, and a real-browser spec. `rip/email`, new under `packages/email`, is email templates authored as components and rendered to a string on the server; the `rip email` CLI is the one thing carried over. Tailwind leaves both.

### Why

- **The browser layer has no consumer and cannot get one.** Nothing outside the package imports `rip/ui/browser`. medlabs hand-copied a subset into `app/lib/aria.rip` because the package-wide `rip.browser` flag cannot be set on a package that also ships server-only Tailwind code, and the copy is already typed differently from the original.
- **Tailwind serves nothing.** The only thing that puts it to work is the email `Tailwind` component, which no template uses; the medlabs layout writes style objects. The package's two dependencies exist for it, and its engine compiles at import, about 80 ms over bare Bun startup for every process that loads the email surface.
- **The primitives work around a v3 defect.** Disposers are stored on elements under `__aria` properties so a re-invocation can tear down the prior one, which the code attributes to a v3 effect dropping its returned cleanup. A compiled probe and `src/runtime/reactive.js` show the v4 effect keeps it.

### The split

`packages/ui` and `packages/email`. The stdlib namespace is read off the packages directory, so both resolve with no resolver change. `rip/ui` declares `rip.browser: true` and a root export; `rip/email` declares neither a flag nor a dependency. `bin/rip` finds a package CLI by manifest, so `rip email` follows the package.

### `rip/ui`

The compound model Radix and Base UI share: one exported part per concept, unstyled, composed by the application, state exposed as data attributes. The attribute spelling is Base UI's, bare booleans such as `data-open`, which Tailwind's `data-open:` variant styles directly. Rip supplies the mechanisms. Parts share state through `offer` and `accept`, children arrive through `slot`, and a part declaring `extends <tag>` forwards the caller's undeclared attributes to its host element, so the application's classes land on the real button or dialog. A root owns its state cell with a default and its parts write it; a parent binds with `<=>` only when it needs to observe or drive it. There is no second API for controlled use.

**Native first.** A component uses the platform's own machinery, and a fallback is added only when a supported browser demonstrably lacks the feature. For `Dialog`: `showModal` gives the top layer, modality, an inert background, Escape, focus containment, and focus restore; light dismiss is `closedby`, whose support floor is ruled when `Popover` arrives; transitions are `@starting-style` with discrete transitions; scroll lock is a CSS rule on `body:has(dialog:modal)`. No JavaScript positioning, focus trap, or scroll lock ships.

**Day one is `Dialog`.** No second component lands until its API has been used by the medlabs screen that needs it.

**Demo and spec.** `packages/ui/demo/` is a Rip app, one route per component, styled with Tailwind classes through the vendored browser runtime, not exported. `packages/ui/test/browser/` holds Playwright specs against it on Chromium, Firefox, and WebKit, asserting platform facts: `dialog:modal` matches after the trigger is clicked, the active element is inside, Escape closes, focus returns to the trigger, Tab from the last focusable wraps. A spec needs three engines and a page that mounts the component from a bundle assembled from the demo's modules and the checkout's `dist/@rip`. Neither shape in `test/browser` is that: the smoke server holds inline fixture modules and the publication protocol, and the live harness stands up a full site behind a stub edge on Chromium only. The demo gets its own server of a few lines and its own Playwright config, sharing the installed Playwright and nothing else.

### `rip/email`

Templates are components, rendered to a string synchronously on Bun. The compiled output hardcodes `document.createElement`, so the package owns a server DOM subset and a render host that installs it on the global for one render and restores the prior globals after, including on throw. This is not SSR; Rip has no hydration. The render host stays in `rip/email` until a second consumer exists.

Styles are strings or objects. The object type is the one the compiler mints for a native tag's `style`, so a `CSSProperties` value passes straight through to a tag; the unitless list is spelled once here and once in the compiler with a lockstep test.

**Day one is exactly what medlabs and the CLI import**: `Email`, `Head`, `Body`, `Preview`, `Container`, `Section`, `Heading`, `Text`, `Link`, `toEmail`, and the `CSSProperties` type, with the rules that make them correct: the XHTML transitional doctype, padding split onto the table cell for Outlook and Klaviyo, the body element carrying background with a zeroed margin, hrefs failing closed on unknown schemes, the plain-text twin, and the preview line.

**The CLI moves over unchanged**: `rip email dev` and `export`, the preview app under the edge, dark-mode simulation, text twin, source view.

### One change

The deletion, both packages, and every outside reference land together: `test/toolchain/dependencies.test.js` asserts no dependencies on either package instead of the Tailwind budget; the approved skip for the old types test leaves `test/toolchain/skips.test.js`; `test/rip/email.rip` is repointed at `rip/email` and pruned to the day-one surface, and `test/rip/email-internals.rip` goes; the roadmap's UI lines are rewritten and its open item on per-package browser flags closed; the Tailwind lockstep notes in `AGENTS.md` and `scripts/tailwind-bundle.mjs` go. medlabs changes its two import specifiers to `rip/email` in the same change.
