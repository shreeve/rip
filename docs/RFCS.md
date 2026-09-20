# Rip RFCs

Design proposals under discussion. The **Tags** column groups by area (`type-system` · `runtime` · `compiler` · `packaging` · `data`), labels rather than partitions, so a cross-cutting RFC carries several.

|    # | RFC                                                                                  | Tags                   | Status      |
| ---: | ------------------------------------------------------------------------------------ | ---------------------- | ----------- |
|    1 | [Split `rip/ui` into headless components and `rip/email`](#rfc-1-split-ripui-into-headless-components-and-ripemail) | `packaging`, `runtime` | 🟢 Implemented |
|    2 | [Context names its provider: `accept name from Provider`](#rfc-2-context-names-its-provider-accept-name-from-provider) | `compiler`, `runtime`, `type-system` | 🟡 Proposed |

---

## RFC 1: Split `rip/ui` into headless components and `rip/email`

> **Status: Implemented.** `rip/ui` opened with Dialog and a Drawer, the Dialog with a side and a swipe to dismiss. Two things landed differently from the text below: the boolean data attributes are present as `true` rather than bare, since presence is all a selector sees, and focus is contained rather than wrapped, since no engine wraps Tab inside a modal dialog.

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

**Demo and spec.** `packages/ui/demo/` is a Rip app, one route per component, styled with Tailwind classes through the vendored browser runtime, not exported. `packages/ui/test/browser/` holds Playwright specs against it on Chromium and WebKit, asserting platform facts: `dialog:modal` matches after the trigger is clicked, the active element is inside, Escape closes, focus returns to the trigger, Tab from the last focusable wraps. A spec needs both engines and a page that mounts the component from a bundle assembled from the demo's modules and the checkout's `dist/@rip`. Neither shape in `test/browser` is that: the smoke server holds inline fixture modules and the publication protocol, and the live harness stands up a full site behind a stub edge on Chromium only. The demo gets its own server of a few lines and its own Playwright config, sharing the installed Playwright and nothing else.

### `rip/email`

Templates are components, rendered to a string synchronously on Bun. The compiled output hardcodes `document.createElement`, so the package owns a server DOM subset and a render host that installs it on the global for one render and restores the prior globals after, including on throw. This is not SSR; Rip has no hydration. The render host stays in `rip/email` until a second consumer exists.

Styles are strings or objects. The object type is the one the compiler mints for a native tag's `style`, so a `CSSProperties` value passes straight through to a tag; the unitless list is spelled once here and once in the compiler with a lockstep test.

**Day one is exactly what medlabs and the CLI import**: `Email`, `Head`, `Body`, `Preview`, `Container`, `Section`, `Heading`, `Text`, `Link`, `toEmail`, and the `CSSProperties` type, with the rules that make them correct: the XHTML transitional doctype, padding split onto the table cell for Outlook and Klaviyo, the body element carrying background with a zeroed margin, hrefs failing closed on unknown schemes, the plain-text twin, and the preview line.

**The CLI moves over unchanged**: `rip email dev` and `export`, the preview app under the edge, dark-mode simulation, text twin, source view.

### One change

The deletion, both packages, and every outside reference land together: `test/toolchain/dependencies.test.js` asserts no dependencies on either package instead of the Tailwind budget; the approved skip for the old types test leaves `test/toolchain/skips.test.js`; `test/rip/email.rip` is repointed at `rip/email` and pruned to the day-one surface, and `test/rip/email-internals.rip` goes; the roadmap's UI lines are rewritten and its open item on per-package browser flags closed; the Tailwind lockstep notes in `AGENTS.md` and `scripts/tailwind-bundle.mjs` go. medlabs changes its two import specifiers to `rip/email` in the same change.

---

## RFC 2: Context names its provider: `accept name from Provider`

> **Status: Proposed.**

`offer` takes one form, a `:=` declaration. `accept` names the component it reads from: `accept open from Dialog`. The runtime resolves the read to the nearest ancestor instance of that component instead of walking a string map, and the typed face types the accepted member as that component's own offered member. `packages/ui` moves in the same change. Nothing else in the language changes.

### Why

- **An accepted member has no type.** The face declares every accept `any`, unconditionally, because the accept carries a bare name and its provider is whichever ancestor happens to offer that string at mount time. Nothing static links `accept open` in `DialogPopup` to `offer @open := false` in `Dialog`. The offer side is typed and checked at the use site; the accept side is where the type story stops, and `rip check --public packages/ui` reports the accepted members as leaks. The audit's ruling row for the channel is parked as "model not settled". This RFC is the model.
- **Three of the four offer forms misbehave at the accept.** The emitter admits `:=`, `=!`, `~=`, and a method as offer payloads. Every accept dereferences `.value`, and the runtime hands a readonly offer's plain value, so `offer limit =! 10` read through `accept limit` renders `undefined`; the recording-DOM harness shows it. A method offer publishes the unbound prototype method, and the accepting component calls it with its own `this`. Only `:=` is used anywhere in the repo.
- **The key namespace is flat, and the package already collides in it.** `Dialog` and `Drawer` both offer `open`, `labelledBy`, and `describedBy`. A `DrawerClose` placed inside a `Dialog` with no `Drawer` above it closes the Dialog, silently, because `getContext('open')` stops at the nearest provider of that string. No type rule can catch this while the accept names a string, because the two providers carry the same type.

### The change

**`offer` takes a `:=` declaration and nothing else.** `=!`, `~=`, and method payloads are compile errors naming the one spelling. Every offered value is therefore a writable state container, which is what every accept already assumes.

**`accept name from Provider`.** `Provider` is a component binding in module scope, defined in the module or imported. The lowering is `this.name = getContext(Provider, 'name')`. The runtime walks the parent chain for the nearest instance of `Provider`, reads the member from that instance's offered set, and returns its container; a miss throws at mount naming both the provider and the member. A `Provider` that is not bound in the module is a compile error at the word; one bound to something that is not a component is a type error on the accept, `'Plain' is not a component, so it offers nothing to accept`, since the emitter cannot see what an import holds. Any binding that holds the component provides, so an alias does: `Drawer = Dialog` makes `accept open from Drawer` the same read. The bare `accept name` is a compile error naming the new spelling.

**The type.** The face declares the accepted member as the provider's own offered member, the taken container `{ value: boolean; read(): boolean; touch?(): void }`, so reads and writes through it type as `boolean`. Every component carries a TS-only `__offers` record of its offered names, empty when it offers nothing, and the accept indexes through it off the provider's value, `NonNullable<InstanceType<typeof Dialog>['__offers']>['open']`, so an alias or an import provides as a direct binding does. It indexes what the provider offers and not what it has: `DialogClose` carries a member named `open`, its own accept, and naming it as a provider is the miss the runtime throws on, so it is a type error at the accept, reported once on the name as `DialogClose offers no 'open'`. The `.d.ts` road shares the segments, so a package's consumers see the same types.

**Hover.** An accepted name answers `(accept) open: boolean`, value-first, the kind minted from the spelling as `(state)` is. The keywords `offer` and `accept` decline as structure keywords do. An offered member answers as its own kind, and nothing in the answer says it is offered.

**What it reaches.** An offered member is readable from anywhere that can import its provider. A library's parts name a provider inside the library. An app that wants a library themed renders the library's provider and hands it the value as a prop. A library cannot reach an app's provider, because it cannot import it. A root offering a value to every descendant is written as a provider component, the same shape the dialog already has:

```
# theme.rip
export Theme = component
  offer @theme := 'dark'
  render
    slot

# card.rip
import { Theme } from './theme.rip'

export Card = component
  accept theme from Theme
  render
    div class: "card card-#{theme}"
      slot
```

### Alternatives

- **Bare `accept name`, provider resolved from scope.** The same guarantees are reachable: the accept names the one component in module scope that offers `name`. The emitter cannot see what an imported name offers, so provenance moves to a type-level search over every in-scope binding and the runtime takes a candidate list instead of one class. The import that brings the provider into scope is referenced by nothing visible, so unused-import logic, go-to-definition, and auto-import all have to learn that an accept consumes it. A module in scope of two providers of one key has no way to say which, and the fix on that day is to add `from`. One word buys all of it directly. The rulings above survive unchanged if the bare form is preferred; only the resolution mechanism differs.
- **Keep the string key, type it from a package-wide map.** Every module's face augments one interface with its offers, keyed by package, and an accept reads its key from it. The type is always right, since two offers of one key with different types error at the second offer, and tsgo confirms the mechanism on hand-written faces. It leaves the collision above untouched, since same-typed offers merge, and it needs a package identity in the emitter, a merge rule, and a collision diagnostic, all of which naming the provider deletes.

### What it costs

- **A part shared across roots.** One close button that works under either of two unrelated roots has no provider to name. The package had exactly this: four Drawer parts are the Dialog's by alias and `DrawerPopup` delegates to `DialogPopup`, all of it resting on the flat namespace, because the Drawer had a root of its own that re-offered the Dialog's three names and added `side`. Only `DrawerPopup` read `side`, so the root had no job. It becomes `Drawer = Dialog`, `side` moves to `DrawerPopup` as a prop, and every part names `Dialog`; the one caller-visible change is `Drawer side: 'right'` becoming `DrawerPopup side: 'right'`. A root cannot instead wrap the provider it wants to stand in for: a root's projected children are constructed before its own render, so they would look for the inner provider before it exists. A part that must serve two roots that really are different has no spelling here; an optional accept mapped to `hasContext` is where it would be designed, and it is not in this RFC.
- **The same-module spelling.** `accept open from Dialog` inside `dialog.rip` names a provider three lines up. It is the price of one spelling.
- **Class identity.** The runtime matches the provider by constructor. HMR replaces classes, so a swapped provider must keep matching its mounted parts, or the swap must remount them.

### Open

- What `accept options from Select` types when the provider takes a type parameter.
- HMR and constructor identity, above.
- Whether an offered member should be reachable across a package boundary at all, or only from its provider's own package. The import makes the read explicit either way; restricting it is one rule at the resolution site.
- How an offer takes an annotation. `offer depth: number := 0` parses as an object and is rejected, so an offer's type comes only from what its initializer spells.

### One change

The grammar production and the emitter's two lowerings, the JS read and the face's declare; the offered-names record in `src/ts/components.js`, which `rip check --public` skips and the browser bundle stubs; the runtime's `getContext` signature; the miss's wording in `mapTsDiagnostic`; `dialog.rip`, and `drawer.rip` reduced to aliases of the Dialog's root and parts with `side` on its popup; the components fixture in the corpus rewritten in the new spelling, its claims rows and error pins, and the ruling row unparked with its hover pin; the emitter-cases battery line and the runtime-components context scenario; `docs/TYPES.md`. medlabs offers and accepts nothing and needs no edit.
