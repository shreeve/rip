<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip UI

> **Unstyled, composable UI components built on native browser features.**

One exported part per concept, unstyled, composed by the application, with state exposed as data attributes. A root owns its state cell and offers it; the parts projected into it accept it and write it; a parent binds the cell with `<=>` only when it needs to observe or drive it. Each part `extends` the tag it renders, so the application's classes and attributes land on the real element, and a part built on another part `extends` that part, so the same attributes pass through it.

**Runtime:** browser-safe (`rip.browser: true`). `ui.rip` is the entry; each component is one file beside it.

## Quick Start

```coffee
import { Dialog, DialogTrigger, DialogPopup, DialogTitle, DialogDescription, DialogClose } from 'rip/ui'

Orders = component
  confirming := false
  render
    Dialog open <=> confirming
      DialogTrigger class: 'btn', 'Delete order'
      DialogPopup class: 'rounded-lg p-6 backdrop:bg-black/40'
        DialogTitle 'Delete this order?'
        DialogDescription 'This cannot be undone.'
        DialogClose class: 'btn', 'Cancel'
        button class: 'btn-danger', @click: (-> remove(); confirming = false), 'Delete'
```

The `open <=> confirming` binding is optional. A dialog nobody observes is the same tree with no props on the root.

## Dialog

Native first: `DialogPopup` is a `<dialog>` opened with `showModal`, which gives the top layer, modality, an inert background, Escape, focus containment, and focus restore to the trigger. No JavaScript positioning or focus trap ships. Containment is not wrapping: past the last focusable, Chromium and WebKit hand focus to the browser's own chrome and the next Tab re-enters the dialog, and Firefox leaves focus where it is; focus never reaches page content outside the modal on any of them.

- `Dialog` — the root. Owns `open` (default `false`) and renders only its children.
- `DialogTrigger` — a `<button>` that opens it. Carries `aria-haspopup="dialog"`, `aria-expanded`, and `data-popup-open` while open.
- `DialogPopup` — the `<dialog>`. Carries `data-open` while open and `data-closed` otherwise, and `aria-labelledby` and `aria-describedby` pointing at the title and description parts when they are present. Takes `closedby` as a prop (`'any'`, `'closerequest'`, or `'none'`) and carries `closedby="any"` when none is passed, so a click on the backdrop closes it as Escape does; `closedby: 'closerequest'` keeps Escape only. Stable Safari and every iOS browser ignore the attribute, so the popup itself closes on a press that starts and ends on the backdrop while the value is `any` and refuses Escape while it is `none`; those handlers go when Safari ships `closedby`. Escape is canceled and writes the cell, and the element's own `close` event writes it too, so Escape, a backdrop click, a close part, and a programmatic close all read the same. Closing keeps the `<dialog>` open and modal until the popup's own animations finish, then calls `close()`, so an exit transition plays on every engine.
- `DialogTitle` — an `<h2>` with a minted id, or the `id` you pass.
- `DialogDescription` — a `<p>` with a minted id, or the `id` you pass.
- `DialogClose` — a `<button>` that closes it.

The attributes are present while true and absent otherwise, so Tailwind's `data-open:` and `data-popup-open:` variants style them directly.

The document does not scroll while a modal dialog is open, with nothing in the application's stylesheet. A modal already holds a scroller behind it still, but not the document's own scroll or its overscroll bounce, so loading the package adopts one stylesheet for the document, `:root:has(dialog:modal) { overflow: hidden; }`. The rule has only the `:has()` selector's specificity, so any rule of the application's overrides it. `:has()` does not see into a shadow root, so a popup rendered inside one does not lock the document.

The transitions stay with the application's stylesheet. They key on `data-open`, never on `[open]`, which stays set through the exit: `@starting-style` for the entry and the attribute's removal for the exit. In Tailwind that is `opacity-0 transition-opacity data-open:opacity-100 starting:data-open:opacity-0`. Discrete transitions on `display` and `overlay` do not substitute: Firefox and WebKit hide a closed dialog at once regardless. The close waits on the popup's own animations and not its `::backdrop`'s, so a backdrop transition longer than the popup's is cut off when the dialog closes.

## Drawer

`Drawer` is the Dialog with a side. The root offers `open` and `side` (`left` by default, or `right`, `top`, `bottom`), and `DrawerTrigger`, `DrawerTitle`, `DrawerDescription`, and `DrawerClose` are the Dialog parts. `DrawerPopup` extends `DialogPopup`, so it is the `<dialog>` with everything `DialogPopup` carries, plus `data-side`, and a swipe: a press inside the panel that travels toward its side drags the panel along with the transition off, and releasing past a quarter of the panel's size or with speed closes it, while a shorter release lets the transition carry it back. The pointer is captured once a drag is past the slop, so a link under a swipe is not clicked when it ends. The swipe runs for every pointer type, mouse included, and only while `closedby` is `any`. The panel's placement and slide are the consumer's classes, as the demo shows; the popup sets `touch-action` along the other axis so content inside still scrolls. A slide built from Tailwind's `translate-x-*` or `translate-y-*` utilities needs the other axis set on the element too (`translate-y-0` for a left or right drawer, `translate-x-0` for a top or bottom one): WebKit does not substitute an unset registered property's initial value inside `@starting-style`, so without it the entry transition starts from `translate: none` and the panel appears without sliding.

## Demo

```bash
bun run demo
```

`demo/` is a Sites project: the manager serves it under the edge at https://ui.local/ with live update on save, one route per component, styled with Tailwind classes through the vendored browser runtime.

## Test

```bash
bun run test
```

Playwright specs in `test/browser/` drive the demo on Chromium and WebKit, on a server of their own that the config starts, or on the running Sites instance with `RIP_UI_URL=https://ui.local/ bun run test`. They assert platform facts: `dialog:modal` matches after the trigger is clicked, the active element is inside, Escape closes and focus returns to the trigger, focus stays contained past either end, and the document does not scroll while a modal is open.
