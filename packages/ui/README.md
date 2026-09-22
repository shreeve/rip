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

Native first: `DialogPopup` is a `<dialog>` opened with `showModal`, which gives the top layer, modality, an inert background, Escape, focus containment, and focus restore to the trigger. No JavaScript positioning ships. No engine wraps Tab inside a modal, so the popup wraps it, the WAI-ARIA modal dialog pattern: a hidden sentinel `<span>` is the popup's first child and another its last, and when the browser's own Tab or Shift+Tab lands on one, it sends focus to the popup's first or last focusable. A focusable is a link with an `href`, a button, an input, a select, a textarea, a summary, a details, an iframe, an object, an embed, media with controls, an editable element, or an element with a `tabindex` of zero or more, rendered, visible, not disabled, and not inert. An iframe is one stop: a Tab inside it never reaches the popup, but the browser's own move out of it lands on a sentinel, so a frame at either end wraps too. The sentinels carry `aria-hidden` and `data-focus-guard`, and the package's own stylesheet hides them. On open, `showModal` focuses the leading sentinel as the first focusable descendant, and the popup moves focus on to the first focusable. A focusable inside a nested shadow root is never a landing spot, since the popup does not see into one, though the sentinels still catch the exit.

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

`Drawer` is the Dialog with a side. The root is `Dialog` itself, and `DrawerTrigger`, `DrawerTitle`, `DrawerDescription`, and `DrawerClose` are the Dialog parts, so a drawer's parts read from the same root a dialog's do. `DrawerPopup` takes the `side` (`left` by default, or `right`, `top`, `bottom`) and extends `DialogPopup`, so it is the `<dialog>` with everything `DialogPopup` carries, plus `data-side`, and a swipe: a press inside the panel that travels toward its side drags the panel along with the transition off, and releasing past a quarter of the panel's size or with speed closes it, while a shorter release lets the transition carry it back. The pointer is captured once a drag is past the slop, so a link under a swipe is not clicked when it ends. The swipe runs for every pointer type, mouse included, and only while `closedby` is `any`. The panel's placement and slide are the consumer's classes, as the demo shows; the popup sets `touch-action` along the other axis so content inside still scrolls. A slide built from Tailwind's `translate-x-*` or `translate-y-*` utilities needs the other axis set on the element too (`translate-y-0` for a left or right drawer, `translate-x-0` for a top or bottom one): WebKit does not substitute an unset registered property's initial value inside `@starting-style`, so without it the entry transition starts from `translate: none` and the panel appears without sliding.

## Menu

Native first: `MenuPopup` is a `popover="auto"` element, which gives the top layer, light dismiss on Escape and on a click outside, and focus restore to the trigger; under a modal dialog the close watcher closes the menu on Escape before the dialog. `MenuTrigger` names the popup in `popovertarget`, so a click toggles it natively and the trigger is the popover's invoker: a click on it while open closes it instead of dismissing and reopening it. Placement is CSS anchor positioning with no JavaScript: the trigger carries a minted `anchor-name` and the popup `position-anchor` and `position-area`, so the popup sits by the trigger however it was opened, and flips to the other side when it does not fit. The popup renders where it is used, never portaled: a popover inside an open modal dialog is interactive there, and one anywhere else in the document would be inert.

The keyboard is the WAI-ARIA menu button pattern. On the trigger, Enter, Space, and ArrowDown open the menu with the first item focused and ArrowUp with the last; a click opens it with the popup itself focused. In the popup, ArrowDown and ArrowUp move between the items and wrap, Home and End jump to the ends, Enter and Space activate the item, Escape closes and returns focus to the trigger, and Tab closes and lets the browser move focus on. The highlight is focus itself, never a second state: the pointer over an item focuses it, leaving the item hands focus back to the popup, and an item is styled with `focus:` and `outline-none`. There is no typeahead.

- `Menu` — the root. Owns `open` (default `false`) and renders only its children.
- `MenuTrigger` — a `<button>` with `popovertarget`, `aria-haspopup="menu"`, `aria-expanded`, and `data-popup-open` while open, with a minted id or the `id` you pass. Its `style` is the anchor name, so `style` does not pass through.
- `MenuPopup` — a `<div popover="auto" role="menu" tabindex="-1">` labelled by the trigger, with a minted id or the `id` you pass. Carries `data-open` while open and `data-closed` otherwise. Takes `side` (`'bottom'` by default, or `'top'`, `'left'`, `'right'`) and `align` (`'start'` by default, or `'center'`, `'end'`). Its `style` is the placement, so `style` does not pass through; the gap from the trigger is your margin.
- `MenuItem` — a `<button role="menuitem">` that closes the menu on click; the `@click` you pass runs too.
- `MenuLink` — an `<a role="menuitem">` with the `href` you pass, that closes the menu on click. A link activates on Enter and not on Space, so the part clicks it on Space.

Every way the popover opens or closes writes `open`: a native hide from `beforetoggle`, which fires synchronously where `toggle` is a task behind the state, and a native show from `toggle`, once the show is complete. The transitions key on `data-open` as Dialog's do, with `transition-discrete` so the `display` and `overlay` transitions on a light dismiss play on Chrome, where the element stays through them. Firefox and WebKit hide a light-dismissed popover at once and the hide is not cancelable, so only a close through the cell (an item, Tab, the parent) waits for the popup's animations before `hidePopover()`. Focus restore is the platform's: `hidePopover` returns focus to the element focused when the popover was shown, when focus is inside at the time, and WebKit does not focus a button on a mouse click, so a mouse-opened menu there returns focus to the body.

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
