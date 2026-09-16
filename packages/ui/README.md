<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip UI

> **Unstyled, composable UI components built on native browser features.**

One exported part per concept, unstyled, composed by the application, with state exposed as data attributes. A root owns its state cell and offers it; the parts projected into it accept it and write it; a parent binds the cell with `<=>` only when it needs to observe or drive it. Each part `extends` the tag it renders, so the application's classes and attributes land on the real element.

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

Native first: `DialogPopup` is a `<dialog>` opened with `showModal`, which gives the top layer, modality, an inert background, Escape, focus containment, and focus restore to the trigger. No JavaScript positioning, focus trap, or scroll lock ships. Containment is not wrapping: past the last focusable, Chromium and WebKit hand focus to the browser's own chrome and the next Tab re-enters the dialog, and Firefox leaves focus where it is; focus never reaches page content outside the modal on any of them.

- `Dialog` — the root. Owns `open` (default `false`) and renders only its children.
- `DialogTrigger` — a `<button>` that opens it. Carries `aria-haspopup="dialog"`, `aria-expanded`, and `data-popup-open` while open.
- `DialogPopup` — the `<dialog>`. Carries `data-open` while open and `data-closed` otherwise, and `aria-labelledby` and `aria-describedby` pointing at the title and description parts when they are present. Carries `closedby="any"` unless the consumer passes its own, so a click on the backdrop closes it as Escape does; `closedby: 'closerequest'` keeps Escape only. The element's own `close` event writes the cell, so Escape, a backdrop click, a close part, and a programmatic close all read the same.
- `DialogTitle` — an `<h2>` with a minted id, or the `id` you pass.
- `DialogDescription` — a `<p>` with a minted id, or the `id` you pass.
- `DialogClose` — a `<button>` that closes it.

The attributes are present while true and absent otherwise, so Tailwind's `data-open:` and `data-popup-open:` variants style them directly.

Two things stay with the application's stylesheet, because they are CSS:

```css
/* scroll lock while any modal dialog is open */
body:has(dialog:modal) { overflow: hidden; }
```

Transitions are `@starting-style` with discrete transitions on `display` and `overlay`; in Tailwind that is `transition-[opacity,overlay,display] transition-discrete starting:open:opacity-0 open:opacity-100 opacity-0`.

## Demo

```bash
bun run demo
```

`demo/` is a Sites project: the manager serves it under the edge at https://ui.local/ with live update on save, one route per component, styled with Tailwind classes through the vendored browser runtime.

## Test

```bash
bun run test
```

Playwright specs in `test/browser/` drive the demo on Chromium, Firefox, and WebKit, on a server of their own that the config starts, or on the running Sites instance with `RIP_UI_URL=https://ui.local/ bun run test`. They assert platform facts: `dialog:modal` matches after the trigger is clicked, the active element is inside, Escape closes and focus returns to the trigger, focus stays contained past either end, and the scroll-lock rule holds while a modal is open.
