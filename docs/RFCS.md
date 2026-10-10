# Rip RFCs

Design proposals under discussion. The **Tags** column groups by area (`type-system` · `runtime` · `compiler` · `packaging` · `data`), labels rather than partitions, so a cross-cutting RFC carries several.

|    # | RFC                                                                                  | Tags                   | Status      |
| ---: | ------------------------------------------------------------------------------------ | ---------------------- | ----------- |
|    1 | [Split `rip/ui` into headless components and `rip/email`](#rfc-1-split-ripui-into-headless-components-and-ripemail) | `packaging`, `runtime` | 🟢 Implemented |
|    2 | [Context names its provider: `accept name from Provider`](#rfc-2-context-names-its-provider-accept-name-from-provider) | `compiler`, `runtime`, `type-system` | 🟢 Implemented |
|    3 | [A child notifies its parent through a callback prop](#rfc-3-a-child-notifies-its-parent-through-a-callback-prop) | `compiler`, `runtime`, `type-system` | 🟢 Implemented |

---

## RFC 1: Split `rip/ui` into headless components and `rip/email`

> **Status: Implemented.** `rip/ui` opened with Dialog and a Drawer, the Dialog with a side and a swipe to dismiss. Two things landed differently from the text below: the boolean data attributes are present as `true` rather than bare, since presence is all a selector sees, and the popup wraps Tab at its ends, since no engine does.

`packages/ui` is rewritten from scratch, in one change, as two packages. `rip/ui`, still under `packages/ui`, is headless compound components, opening with `Dialog`, a demo route, and a real-browser spec. `rip/email`, new under `packages/email`, is email templates authored as components and rendered to a string on the server; the `rip email` CLI is the one thing carried over. Tailwind leaves both.

### Why

- **The browser layer has no consumer and cannot get one.** Nothing outside the package imports `rip/ui/browser`. An application hand-copied a subset into its own library because the package-wide `rip.browser` flag cannot be set on a package that also ships server-only Tailwind code, and the copy is already typed differently from the original.
- **Tailwind serves nothing.** The only thing that puts it to work is the email `Tailwind` component, which no template uses; the application layouts write style objects. The package's two dependencies exist for it, and its engine compiles at import, about 80 ms over bare Bun startup for every process that loads the email surface.
- **The primitives work around a v3 defect.** Disposers are stored on elements under `__aria` properties so a re-invocation can tear down the prior one, which the code attributes to a v3 effect dropping its returned cleanup. A compiled probe and `src/runtime/reactive.js` show the v4 effect keeps it.

### The split

`packages/ui` and `packages/email`. The stdlib namespace is read off the packages directory, so both resolve with no resolver change. `rip/ui` declares `rip.browser: true` and a root export; `rip/email` declares neither a flag nor a dependency. `bin/rip` finds a package CLI by manifest, so `rip email` follows the package.

### `rip/ui`

The compound model Radix and Base UI share: one exported part per concept, unstyled, composed by the application, state exposed as data attributes. The attribute spelling is Base UI's, bare booleans such as `data-open`, which Tailwind's `data-open:` variant styles directly. Rip supplies the mechanisms. Parts share state through `offer` and `accept`, children arrive through `slot`, and a part declaring `extends <tag>` forwards the caller's undeclared attributes to its host element, so the application's classes land on the real button or dialog. A root owns its state cell with a default and its parts write it; a parent binds with `<=>` only when it needs to observe or drive it. There is no second API for controlled use.

**Native first.** A component uses the platform's own machinery, and a fallback is added only when a supported browser demonstrably lacks the feature. For `Dialog`: `showModal` gives the top layer, modality, an inert background, Escape, focus containment, and focus restore; light dismiss is `closedby`, whose support floor is ruled when `Popover` arrives; transitions are `@starting-style` with discrete transitions; scroll lock is a CSS rule on `body:has(dialog:modal)`. No JavaScript positioning, focus trap, or scroll lock ships.

**Day one is `Dialog`.** No second component lands until its API has been used by an application screen that needs it.

**Demo and spec.** `packages/ui/demo/` is a Rip app, one route per component, styled with Tailwind classes through the vendored browser runtime, not exported. `packages/ui/test/browser/` holds Playwright specs against it on Chromium and WebKit, asserting platform facts: `dialog:modal` matches after the trigger is clicked, the active element is inside, Escape closes, focus returns to the trigger, Tab from the last focusable wraps. A spec needs both engines and a page that mounts the component from a bundle assembled from the demo's modules and the checkout's `dist/@rip`. Neither shape in `test/browser` is that: the smoke server holds inline fixture modules and the publication protocol, and the live harness stands up a full site behind a stub edge on Chromium only. The demo gets its own server of a few lines and its own Playwright config, sharing the installed Playwright and nothing else.

### `rip/email`

Templates are components, rendered to a string synchronously on Bun. The compiled output hardcodes `document.createElement`, so the package owns a server DOM subset and a render host that installs it on the global for one render and restores the prior globals after, including on throw. This is not SSR; Rip has no hydration. The render host stays in `rip/email` until a second consumer exists.

Styles are strings or objects. The object type is the one the compiler mints for a native tag's `style`, so a `CSSProperties` value passes straight through to a tag; the unitless list is spelled once here and once in the compiler with a lockstep test.

**Day one is exactly what the CLI and the application templates import**: `Email`, `Head`, `Body`, `Preview`, `Container`, `Section`, `Heading`, `Text`, `Link`, `toEmail`, and the `CSSProperties` type, with the rules that make them correct: the XHTML transitional doctype, padding split onto the table cell for Outlook and Klaviyo, the body element carrying background with a zeroed margin, hrefs failing closed on unknown schemes, the plain-text twin, and the preview line.

**The CLI moves over unchanged**: `rip email dev` and `export`, the preview app under the edge, dark-mode simulation, text twin, source view.

### One change

The deletion, both packages, and every outside reference land together: `test/toolchain/dependencies.test.js` asserts no dependencies on either package instead of the Tailwind budget; the approved skip for the old types test leaves `test/toolchain/skips.test.js`; `test/rip/email.rip` is repointed at `rip/email` and pruned to the day-one surface, and `test/rip/email-internals.rip` goes; the roadmap's UI lines are rewritten and its open item on per-package browser flags closed; the Tailwind lockstep notes in `AGENTS.md` and `scripts/tailwind-bundle.mjs` go.

---

## RFC 2: Context names its provider: `accept name from Provider`

> **Status: Implemented.** Four things landed differently from the first draft of this text, and the sections below say them as they are: the Drawer's root became the Dialog's, with `side` on its popup, where the draft took the package's parts to be separate already; an offer takes an annotation, which no offer could before; a provider that holds no component is a type error on the accept and a throw at mount, where the draft promised a compile error the emitter cannot deliver for an import; and the hand-callable reads name their provider as `accept` does, which the draft left unsaid.

`offer` takes one form, a `:=` declaration. `accept` names the component it reads from: `accept open from Dialog`. The runtime resolves the read to the nearest ancestor instance of that component instead of walking a string map, and the typed face types the accepted member as that component's own offered member. The hand-callable `getContext` and `hasContext` name their provider the same way. `packages/ui` moves in the same change. Nothing else in the language changes.

### Why

- **An accepted member has no type.** The face declares every accept `any`, unconditionally, because the accept carries a bare name and its provider is whichever ancestor happens to offer that string at mount time. Nothing static links `accept open` in `DialogPopup` to `offer @open := false` in `Dialog`. The offer side is typed and checked at the use site, though only from what its initializer spells, since `offer depth: number := 0` reads as an object and is rejected; the accept side is where the type story stops, and `rip check --public packages/ui` reports the accepted members as leaks. The audit's ruling row for the channel is parked as "model not settled". This RFC is the model.
- **Three of the four offer forms misbehave at the accept.** The emitter admits `:=`, `=!`, `~=`, and a method as offer payloads, and every accept treats what it receives as a writable state: it reads and writes `.value`. The runtime hands a readonly offer's plain value, so `offer limit =! 10` read through `accept limit` is `undefined`. A method offer hands the function, so calling the accepted `save` throws `this.save.value is not a function`. A computed offer reads correctly and throws on the write the accept's type invites, `Attempted to assign to readonly property`. None of the three is refused at compile time. Only `:=` is used anywhere in the repo.
- **The key namespace is flat, and the package already collides in it.** `Dialog` and `Drawer` both offer `open`, `labelledBy`, and `describedBy`. A `DrawerClose` placed inside a `Dialog` with no `Drawer` above it closes the Dialog, silently, because `getContext('open')` stops at the nearest provider of that string. No type rule can catch this while the accept names a string, because the two providers carry the same type.

### The change

**`offer` takes a `:=` declaration and nothing else.** `=!`, `~=`, and method payloads are compile errors naming the one spelling. Every offered value is therefore a writable state container, which is what every accept already assumes. `offer` opens a declaration the way `export` does, so an offer takes an annotation like any other state: `offer @side: Side := 'left'`.

**`accept name from Provider`.** `Provider` is a component binding in module scope, defined in the module or imported. The lowering is `this.name = getContext(Provider, 'name')`. The runtime walks the parent chain for the nearest instance of `Provider`, reads the member from that instance's offered set, and returns its container; a miss throws at mount naming both the provider and the member. A `Provider` that is not bound in the module is a compile error at the word. One bound to something that is not a component is caught where it can be seen: the emitter cannot tell what an import holds, so it is a type error on the accept, `'Plain' is not a component, so it offers nothing to accept`, and in untyped code a throw at mount that names the member. Any binding that holds the component provides, so an alias does, as it does everywhere else a component is named: `Drawer = Dialog` makes `accept open from Drawer` the same read, and an app that imports `Drawer` writes that. The bare `accept name` is a compile error naming the new spelling.

**The calls underneath.** `setContext`, `getContext`, and `hasContext` are callable from source, and `offer` and `accept` are spellings over them. The two reads name their provider too: `getContext(Provider, key)` and `hasContext(Provider, key)`. A read by key alone is the flat namespace under another name, so it is refused at the call, pointing at the spelling. Nothing is lost with it: `setContext` runs only inside a component's init, so every value has a provider to name, a plain value comes back as it was set, and a class written by hand provides as a compiled one does. This breaks any caller outside these repos that reads by key alone. `setContext(key, value)` is unchanged.

**The type.** The face declares the accepted member as the provider's own offered member, the taken container `{ value: boolean; read(): boolean; touch?(): void }`, so reads and writes through it type as `boolean`. Every component carries a TS-only `__offers` record of its offered names, empty when it offers nothing, and the accept indexes through it off the provider's value, `NonNullable<InstanceType<typeof Dialog>['__offers']>['open']`, so an alias or an import provides as a direct binding does. It indexes what the provider offers and not what it has: `DialogClose` carries a member named `open`, its own accept, and naming it as a provider is the miss the runtime throws on, so it is a type error at the accept, reported once on the name as `DialogClose offers no 'open'`. The `.d.ts` road shares the segments, so a package's consumers see the same types.

**Hover.** An accepted name answers `(accept) open: boolean`, value-first, the kind minted from the spelling as `(state)` is. The keywords `offer`, `accept`, and `from` decline as structure keywords do. An offered member answers as its own kind, and nothing in the answer says it is offered.

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

### Ruled

- **A generic provider.** An accept from `Select<T>` reads the member at `T`'s constraint, `unknown` when it has none: `InstanceType` of an uninstantiated generic is what TypeScript gives, and a part cannot know which `T` its ancestor was built with. A part that needs the concrete type takes it as a prop, as a generic component's data arrives anyway. The case is thin by construction: a component is generic because data flows through it by props, and it uses context because a root shares state with parts, and parts compare or assign what they accept rather than read fields off it. Base UI's Select, whose root is generic, types the shared value `any` in its context and has each item compare its own `value` prop.
- **HMR and class identity.** A hot swap re-points each living instance at its definition's next class one at a time, so within a round a part rebuilt before the provider above it names the new class while the instance still wears the old one, and its accept misses. The runtime reaches that order when a part's module and an app-defined provider's module change in one round with the part's path first; a single edit invalidates the changed file before its importers, and modules under `rip/` never swap. The context walk therefore matches on the definition's `__hmrId` as well as the class, HMR's own word for the same definition, and no production class carries one.
- **Reach across a package boundary.** Allowed: whoever can import the provider can accept from it, and the import makes the read explicit. Narrowing later is one rule at the resolution site; widening later would break callers.
- **A part shared across roots.** No spelling, by design. Where two roots share their parts they are one root, as the Drawer showed; where they truly differ, a part per root, as Radix and Base UI ship. A real case for a part that must serve two roots can argue for an optional accept then.

### One change

The grammar production, the lexer's statement boundary for `offer`, and the emitter's two lowerings, the JS read and the face's declare; the offered-names record in `src/ts/components.js`, which `rip check --public` skips and the browser bundle stubs; the runtime's `getContext` and `hasContext` signatures, with every hand-written read in the tests naming its provider; the miss's wording in `mapTsDiagnostic`; `dialog.rip`, and `drawer.rip` reduced to aliases of the Dialog's root and parts with `side` on its popup; the components fixture in the corpus rewritten in the new spelling, its claims rows and error pins, and the ruling row unparked with its hover pin; the emitter-cases battery line and the runtime-components context scenario; `docs/TYPES.md`.

---

## RFC 3: A child notifies its parent through a callback prop

> **Status: Implemented.** Three things landed differently from the text below: the host rides every component's face as a record, `__host: { el: <tag interface> }` or `{}`, because the class road extends an `any` base, where an absent member indexes silently; a missing required prop is named from the emitter's records, the keys a construction passes against the props a module-scope component requires, because tsgo's sentence elides the arm that names it, so an imported component keeps the checker's words; and a component that declares its own `emit` member keeps it, since nothing on the base collides with the name now.

A component that has something to tell its parent declares a function-typed prop and calls it: `@onEnded?: (seconds: number) => void` in the head, `onEnded? seconds` in the body, `Timer duration: 3, onEnded: (seconds) -> …` at the use site. There is no event concept. `@emit` leaves the runtime, and `@name:` on a component means a DOM listener on the component's host element and nothing else, so it is refused on a component that extends no tag. The prop head learns to take a function type without wrapping parens.

### Why

- **Two ways exist.** A child can declare `@onEnded?: ((seconds: number) => void)` and call it, or write `@emit('ended', seconds)` and have the parent bind `@ended:`. The first is typed and declared; the second is neither, and application code holds both.
- **`@emit` checks nothing.** `@donee:` on the parent, `@timerEnd:` on a relay, and `@emit('endd')` in the child all pass `rip check` under `rip.strict`, and the handler never runs: the listener is `addEventListener('donee', (e: any) => …)` and the base class declares `emit: (name: string, detail?: unknown)`. A payload has no type, and at a component site every handler casts `as any`, DOM names included, so `Picture src: x, @click: (e) -> e.clientX` on a component extending `img` reports TS7006 on `e`, where the same handler on a bare `img` types it.
- **Events bubble through the DOM.** `emit` dispatches a `CustomEvent` with `bubbles: true` on the child's first node, and a parent's `@name:` listens on that node, so the event continues upward. Driven over the recording DOM with `Timer` in `Card` in `Wizard` in `Page`, one `ended` fired handlers bound on all four and on a plain `div` above them. A handler bound on `Card` for an event `Card` never emits receives whatever any descendant emits under that name, so a typed handler would hold a stranger's payload, the silent-miscompile class.
- **The DOM vocabulary leaks into custom names.** `ended` is a media event, so a bare `Timer duration: 3, @ended` passes the check that refuses `@saved`, and the event word on that site hovers `HTMLElementEventMap['ended']`, an event the timer never dispatches.
- **Callback props already do the job.** `Child onEnded: (n) -> n.nope()` errors with `nope` not on `number`, so the parent's lambda is typed from the declaration; omitting a required `@onDone: (() => void)` is an error; `onEnded? 3` compiles to `this.onEnded.value?.(3)` and an absent handler is a no-op; `Child onEnded: onEnded` forwards the parent's own prop; an unknown `onFoo:` is refused at the face on an `extends` component and thrown at construction on any other. Nothing bubbles and nothing needs a mounted root.
- **The field agrees.** React and Solid have only callback props. Svelte 5 deprecated its dispatcher for them, citing boilerplate, `CustomEvent` objects built for events with no listener, no way to know which handlers were provided or to mark one required, and no way to guarantee a component does not emit a given event. Vue and Angular keep a declared channel, and both call the handler directly with the value and never bubble; Vue lets an undeclared listener fall through to the root element as a native one, which is the ambiguity above. Only Lit dispatches real DOM events, and nothing there checks a name at the use site.

### The change

**The prop head takes a function type bare.** `@onEnded?: (seconds: number) => void` parses. Today only `((seconds: number) => void)` does in a head, while a local and a parameter already take the bare form; a grammar fix, with no change to what the face sees.

**`emit` leaves the runtime.** `@emit` inside a component body is a compile error at the word, naming the prop form.

**`@name:` on a component is a DOM listener on its host.** A component that extends a tag keeps `@click:`, typed as a native site is, `HTMLElementEventMap['click'] & { target: <button>; currentTarget: <button> }`, which `Button` and `Menu.Item` gain in place of today's `any`; a custom name is admitted there as on a native element, since a host document may read its own spellings. A component that extends no tag has no host, so any `@name:` on it is a compile error naming the prop form. The ui package's demo binds DOM events on components only where they extend a tag, so it pays nothing.

**A missing required prop reads as one.** Omitting `@onDone: (() => void)` today reports TS2345 in the words of `__bind_onDone__`. `mapTsDiagnostic` words it `Child requires 'onDone'`, for every required prop.

**Convention.** A callback prop is `on` plus a capitalized word, `onEnded`, `onPay`, unenforced, as React spells it. It is optional unless the component cannot work unanswered, called `onEnded? seconds` or `onDone?()`, and forwarded by naming the parent's own prop, `Timer duration: 3, onEnded: onTimerEnded`.

A timer inside a card inside a wizard, the wizard telling its route when it is done:

```
# the route
Wizard steps: steps, onDone: -> @router.push('/orders')

# wizard.rip
export Wizard = component
  @steps: Step[]
  @onDone?: () => void
  step := 0
  …
  timerEnded = (index: number) ->
    advance() if step is index

  render
    …
        Card step: s, onTimerEnded: -> timerEnded(i)
    …
        Button @click: -> if step is last then onDone?() else advance()

Card = component
  @step: Step
  @onTimerEnded?: () => void
  render
    …
      if step.timer
        Timer duration: step.timer, onEnded: onTimerEnded

Timer = component
  @duration: number
  @onEnded?: () => void
  …
  finish = ->
    running = false
    onEnded?()
```

### Alternatives

- **A declared event channel: `emit @ended: number`.** The Vue and Angular shape: a contextual keyword beside `offer` and `accept`, a minted method the body calls, a `__events` record on the face, a handler key the runtime validates, and `@ended:` at the use site beside `@click:`. That spelling is the whole gain. Everything else it would deliver, declaration, typing at both ends, optional or required, forwarding by name, no bubbling, is what callback props do now, and it would cost a keyword through the lexer, grammar, emitter, runtime, face, and three editor grammars, a second concept beside props, and every callback prop already written migrating the other way.
- **Keep `emit`, typed by one overload per event.** The channel stays a DOM dispatch, so it still bubbles and still needs a mounted root, and the name still has no symbol.

### Ruled

- **A parent is the only listener.** Nothing outside the parent observes a callback. A deep descendant that must reach an ancestor relays through each parent's props, or writes an offered state the ancestor provides.
- **A function prop is a prop.** It rides the sharing contract like any other: a bare member name passes its container, any other expression snapshots. Nothing is special about it.
- **A prop named `onError` is a prop.** The boundary walk reads `onError` off each instance, so a prop of that name, the natural one for an error callback, is called as a boundary and declines only because its container is not callable. A hook is a prototype method and a prop an own property, and a component declaring both is already a duplicate at compile, so the walk reads the hook from the prototype and a prop never reaches it.
- **Required stays rare.** `@onDone: () => void` with no `?` refuses a construction without it, as a bare prop does. The default is optional, since a `Timer` with no listener is a timer that counts down.

### One change

The prop-head production in `grammar.rip`; the emitter's `@emit` refusal, the hostless `@name:` refusal, and the host-typed cast at `extends` sites; the removal of `emit` from `src/runtime/components.js` and its pins in `test/ui`; the required-prop wording in `mapTsDiagnostic`; the boundary walk reading `onError` from the prototype, with its pin; the corpus fixture's claims rows and error pins; `docs/TYPES.md`.
