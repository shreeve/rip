<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip UI

> **Unstyled, composable UI components built on native browser features.**

Each component is a module namespace, one export per part, unstyled, composed by the application, with state exposed as data attributes. A root owns its state cell and offers it; the parts projected into it accept it and write it; a parent binds the cell with `<=>` only when it needs to observe or drive it. Each part `extends` the tag it renders, so the application's classes and attributes land on the real element, and a part built on another part `extends` that part, so the same attributes pass through it.

**Runtime:** browser-safe (`rip.browser: true`). `ui.rip` is the entry, publishing each component's module as one name (`export * as Dialog from './dialog.rip'`), so `import { Dialog } from 'rip/ui'` gives the parts as `Dialog.Root`, `Dialog.Trigger`, and the types as `Dialog.ClosedBy`. Each module is also a package subpath, `rip/ui/dialog.rip`, `rip/ui/drawer.rip`, `rip/ui/menu.rip`, so an application can wrap a component as its own namespace: a module that re-exports the library's parts and declares the one part it changes, since a module's own export shadows a star re-export's.

```coffee
import { Dialog } from 'rip/ui'
export * from 'rip/ui/dialog.rip'

export Popup = component extends Dialog.Popup
  @title?: string
  render
    Dialog.Popup class: 'rounded-xl bg-surface p-6'
      if title
        Dialog.Title class: 'text-lg font-semibold', title
      slot
```

Imported as `import * as Dialog from './dialog.rip'`, that module reads exactly like the library's.

## Quick Start

```coffee
import { Dialog } from 'rip/ui'

Orders = component
  confirming := false
  render
    Dialog.Root open <=> confirming
      Dialog.Trigger class: 'btn', 'Delete order'
      Dialog.Popup class: 'rounded-lg p-6 backdrop:bg-black/40'
        Dialog.Title 'Delete this order?'
        Dialog.Description 'This cannot be undone.'
        Dialog.Close class: 'btn', 'Cancel'
        button class: 'btn-danger', @click: (-> remove(); confirming = false), 'Delete'
```

The `open <=> confirming` binding is optional. A dialog nobody observes is the same tree with no props on the root.

## Your own element as a part

Every part that renders a tag takes `asChild`: it then renders the one element you project as its host instead of creating its own, so your `Button` component is the trigger, with the part's attributes, listeners, and state on your element.

```coffee
import { Dialog } from 'rip/ui'
import { Button } from './button.rip'

Orders = component
  render
    Dialog.Root
      Dialog.Trigger asChild
        Button 'Delete order'
      Dialog.Popup class: 'rounded-lg p-6 backdrop:bg-black/40'
        Dialog.Title 'Delete this order?'
        Dialog.Close asChild
          Button variant: 'secondary', 'Cancel'
```

The body must be exactly one element, a component counting through its root element; anything else throws at mount naming the part. The part's own attributes win where both set one (`type` on a trigger), and the element carries the part's `data-part`. Props you pass the part beyond its own (`id`, `aria-label`) still reach the element, and a `class` passed there replaces the element's own, so style the element on your component. A `style` object the part sets replaces the element's too: `Menu.Trigger` sets the anchor style, so a menu trigger's element keeps its styling in classes. (Without `asChild`, a `class` or `style` you pass a part merges with the part's own on the element it creates, and a style key the part also sets throws naming the part and the key.) `Dialog.Popup` and `Menu.Popup` take the mode by the same mechanism but are not exercised under it.

## Dialog

Native first: `Dialog.Popup` is a `<dialog>` opened with `showModal`, which gives the top layer, modality, an inert background, Escape, focus containment, and focus restore to the trigger. No JavaScript positioning ships. No engine wraps Tab inside a modal, so the popup wraps it, the WAI-ARIA modal dialog pattern: a hidden sentinel `<span>` is the popup's first child and another its last, and when the browser's own Tab or Shift+Tab lands on one, it sends focus to the popup's first or last focusable. A focusable is a link with an `href`, a button, an input, a select, a textarea, a summary, a details, an iframe, an object, an embed, media with controls, an editable element, or an element with a `tabindex` of zero or more, rendered, visible, not disabled, and not inert. An iframe is one stop: a Tab inside it never reaches the popup, but the browser's own move out of it lands on a sentinel, so a frame at either end wraps too. The sentinels carry `aria-hidden` and `data-focus-guard`, and the package's own stylesheet hides them. On open, `showModal` focuses the leading sentinel as the first focusable descendant, and the popup moves focus on to the first focusable. A focusable inside a nested shadow root is never a landing spot, since the popup does not see into one, though the sentinels still catch the exit.

- `Dialog.Root` — the root. Owns `open` (default `false`) and renders only its children.
- `Dialog.Trigger` — a `<button>` that opens it. Carries `aria-haspopup="dialog"`, `aria-expanded`, and `data-popup-open` while open.
- `Dialog.Popup` — the `<dialog>`. Carries `data-open` while open and `data-closed` otherwise, and `aria-labelledby` and `aria-describedby` pointing at the title and description parts when they are present. Takes `closedby` as a prop (`'any'`, `'closerequest'`, or `'none'`) and carries `closedby="any"` when none is passed, so a click on the backdrop closes it as Escape does; `closedby: 'closerequest'` keeps Escape only. Stable Safari and every iOS browser ignore the attribute, so the popup itself closes on a press that starts and ends on the backdrop while the value is `any` and refuses Escape while it is `none`; those handlers go when Safari ships `closedby`. Escape is canceled and writes the cell, and the element's own `close` event writes it too, so Escape, a backdrop click, a close part, and a programmatic close all read the same. Closing keeps the `<dialog>` open and modal until the popup's own animations finish, then calls `close()`, so an exit transition plays on every engine.
- `Dialog.Title` — an `<h2>` with a minted id, or the `id` you pass.
- `Dialog.Description` — a `<p>` with a minted id, or the `id` you pass.
- `Dialog.Close` — a `<button>` that closes it.

`Dialog.ClosedBy` is the type of `closedby`.

The attributes are present while true and absent otherwise, so Tailwind's `data-open:` and `data-popup-open:` variants style them directly.

The document does not scroll while a modal dialog is open, with nothing in the application's stylesheet. A modal already holds a scroller behind it still, but not the document's own scroll or its overscroll bounce, so loading the package adopts one stylesheet for the document, `:root:has(dialog:modal) { overflow: hidden; }`. The rule has only the `:has()` selector's specificity, so any rule of the application's overrides it. `:has()` does not see into a shadow root, so a popup rendered inside one does not lock the document.

The transitions stay with the application's stylesheet. They key on `data-open`, never on `[open]`, which stays set through the exit: `@starting-style` for the entry and the attribute's removal for the exit. In Tailwind that is `opacity-0 transition-opacity data-open:opacity-100 starting:data-open:opacity-0`. Discrete transitions on `display` and `overlay` do not substitute: Firefox hides a closed dialog at once regardless, and so does Playwright's WebKit build, though Safari keeps it through the `display` transition as Chrome does. The close waits on the popup's own animations and not its `::backdrop`'s, so a backdrop transition longer than the popup's is cut off when the dialog closes.

## Drawer

`Drawer` is the Dialog with a side. Its module re-exports the Dialog's, so `Drawer.Root` is `Dialog.Root` itself and `Drawer.Trigger`, `Drawer.Title`, `Drawer.Description`, and `Drawer.Close` are the Dialog parts, and a drawer's parts read from the same root a dialog's do. `Drawer.Popup` takes the `side` (`left` by default, or `right`, `top`, `bottom`; the type is `Drawer.Side`) and extends `Dialog.Popup`, so it is the `<dialog>` with everything `Dialog.Popup` carries, plus `data-side`, and a swipe: a press inside the panel that travels toward its side drags the panel along with the transition off, and releasing past a quarter of the panel's size or with speed closes it, while a shorter release lets the transition carry it back. The pointer is captured once a drag is past the slop, so a link under a swipe is not clicked when it ends. The swipe runs for every pointer type, mouse included, and only while `closedby` is `any`. The panel's placement and slide are the consumer's classes, as the demo shows; the popup sets `touch-action` along the other axis so content inside still scrolls. A slide built from Tailwind's `translate-x-*` or `translate-y-*` utilities needs the other axis set on the element too (`translate-y-0` for a left or right drawer, `translate-x-0` for a top or bottom one): WebKit does not substitute an unset registered property's initial value inside `@starting-style`, so without it the entry transition starts from `translate: none` and the panel appears without sliding.

## Menu

Native first: `Menu.Popup` is a `popover="auto"` element, which gives the top layer, light dismiss on Escape and on a click outside, and focus restore to the trigger; under a modal dialog the close watcher closes the menu on Escape before the dialog. `Menu.Trigger` names the popup in `popovertarget`, so a click toggles it natively and the trigger is the popover's invoker: a click on it while open closes it instead of dismissing and reopening it. Placement is CSS anchor positioning: the trigger carries a minted `anchor-name` and the popup `position-anchor` and `position-area`, so the popup sits by the trigger however it was opened, and flips to the other side when it does not fit; a horizontal side with no room on either side falls through to below, then above, with the same offset. Where the popup sits relative to the trigger is the popup's props, `side`, `align`, and `sideOffset`; how it looks is your classes. Nothing in CSS says which side a flip landed the popup on, so the popup reads it from its computed `position-area` once shown and again on resize and scroll, and publishes it as `data-side` and as a `--transform-origin` variable, so an entry transform written as `origin-(--transform-origin)` grows from the trigger's corner on either side. The popup renders where it is used, never portaled: a popover inside an open modal dialog is interactive there, and one anywhere else in the document would be inert.

The keyboard is the WAI-ARIA menu button pattern. On the trigger, Enter, Space, and ArrowDown open the menu with the first item focused and ArrowUp with the last; a click opens it with the popup itself focused. In the popup, ArrowDown and ArrowUp move between the items and wrap, Home and End jump to the ends, Enter and Space activate the item, Escape closes and returns focus to the trigger, and Tab closes and lets the browser move focus on. The highlight is focus itself, never a second state: the pointer over an item focuses it, leaving the item hands focus back to the popup, and an item is styled with `focus:` and `outline-none`. There is no typeahead.

- `Menu.Root` — the root. Owns `open` (default `false`) and renders only its children.
- `Menu.Trigger` — a `<button>` with `popovertarget`, `aria-haspopup="menu"`, `aria-expanded`, and `data-popup-open` while open, with a minted id or the `id` you pass. Its `style` is the anchor name, so `style` does not pass through.
- `Menu.Popup` — a `<div popover="auto" role="menu" tabindex="-1">` labelled by the trigger, with a minted id or the `id` you pass. Carries `data-open` while open and `data-closed` otherwise, and `data-side` with the side it landed on. Takes `side` (`'bottom'` by default, or `'top'`, `'left'`, `'right'`; the type is `Menu.Side`), `align` (`'start'` by default, or `'center'`, `'end'`; `Menu.Align`), and `sideOffset`, the distance from the trigger in pixels (`0` by default), which a flip carries to the other side. Its `style` is the placement, so a `style` you pass merges beside it and may not set a key the placement sets (the anchor, area, and fallbacks, `inset`, the offset margin, and the `--rip-menu-*` and `--transform-origin` variables), and a margin class on it has no part in the placement.
- `Menu.Item` — a `<button role="menuitem">` that closes the menu on click; the `@click` you pass runs too.
- `Menu.Link` — an `<a role="menuitem">` with the `href` you pass, that closes the menu on click. A link activates on Enter and not on Space, so the part clicks it on Space.

Every way the popover opens or closes writes `open`: a native hide from `beforetoggle`, which fires synchronously where `toggle` is a task behind the state, and a native show from `toggle`, once the show is complete. The transitions key on `data-open` as Dialog's do, with `transition-discrete` so a light dismiss plays the exit too: Chrome and Safari keep the element rendered through the discrete `display` transition. Firefox hides a light-dismissed popover at once and the hide is not cancelable, so only a close through the cell (an item, Tab, the parent) waits for the popup's animations before `hidePopover()`. Playwright's WebKit build hides at once as Firefox does, so the specs pin the exit on the cell's path only. Focus restore is the platform's: `hidePopover` returns focus to the element focused when the popover was shown, when focus is inside at the time, and WebKit does not focus a button on a mouse click, so a mouse-opened menu there returns focus to the body.

The support floor is anchor positioning: Chrome 125, Safari 26, Firefox 147.

## Demo

```bash
bun run demo
```

`demo/` is a Sites project: the manager serves it under the edge at https://ui.local/ with live update on save, one route per component, styled with Tailwind classes through the vendored browser runtime.

## Test

```bash
bun run test
```

Playwright specs in `test/browser/` drive the demo on Chromium and WebKit, on a server of their own that the config starts, or on the running Sites instance with `RIP_UI_URL=https://ui.local/ bun run test`. They assert platform facts: `dialog:modal` matches after the trigger is clicked, the active element is inside, Escape closes and focus returns to the trigger, Tab wraps at either end, and the document does not scroll while a modal is open; a menu's popover matches `:popover-open` under the trigger, the keys move focus between the items, a click on the trigger while open closes it, and Escape under a modal dialog closes the menu first.
