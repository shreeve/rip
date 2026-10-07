# Browser behavior rip/ui works around

Each entry is an engine behavior that shapes how a rip/ui part is built or what it can promise. An entry names the engines it was measured on, links its bug where one is filed, and has a page under [`repro/`](repro/) with no rip code in it, which is what a bug report attaches. Every page reports what it measures, so an entry is rechecked by opening its page. Entries a page can measure without a device are pinned by [`test/browser/browsers.spec.mjs`](test/browser/browsers.spec.mjs), which drives the pages on Playwright's engines in `bun run test` and fails when an engine changes; a failing pin names the entry to update and the workaround to drop once the engine fixed it. What no pin can see, the entry says how to watch.

Engine facts live here and nowhere else. A comment or the README states what a part promises and points here for the engine behind it.

Safari on a device and Playwright's WebKit are recorded separately and neither stands in for the other: Safari 26.6 on macOS keeps a closed dialog rendered through a discrete transition; Playwright's WebKit 26.5 and Safari 27 drop it. Firefox is Playwright's Firefox 153, and its pins run only under the suite's `firefox` project, which certification enables with `RIP_FIREFOX`.

## A popover anchored inside a modal dialog is off by the page scroll

- **Behavior:** a popover positioned by CSS anchor positioning, anchored to an element inside a modal `<dialog>`, lands above its anchor by exactly the page's scroll offset, whether the popover is inside the dialog or outside it. The same pair on the page, with no dialog, is placed correctly. Turning off the dialog's `overflow: hidden` on the document does not change it. Chromium places it correctly.
- **Measured on:** Safari 27 on iOS and Safari 27.0.1 on macOS, with the page and the demo; Playwright's WebKit 26.5. Correct on Chromium 151 and Firefox 153.
- **Bug:** [WebKit 324348](https://bugs.webkit.org/show_bug.cgi?id=324348) (resolved: a Safari 27 regression, fixed in trunk and on a Safari branch; Safari 27.0.1 still carries it).
- **Repro:** [`repro/anchor-in-modal.html`](repro/anchor-in-modal.html). Each case scrolls to the bottom and reports the popover's error; 0 is correct.
- **Pin:** `an anchored popover inside a modal is off by the page scroll in WebKit, and placed elsewhere`.
- **Affects:** every anchored popup inside a `Dialog.Popup` or `Drawer.Popup` on a scrolled page: the Combobox popup and the Menu, which both place through [`components/anchored.rip`](components/anchored.rip). The popup opens off-screen, so it looks as if it never opened.
- **Workaround:** none yet.

## A closed dialog or a hidden popover drops at once

- **Behavior:** `close()` on a modal dialog, and `hidePopover()` or a light dismiss on a popover, remove the element from rendering in the same frame, even with discrete transitions on `display` and `overlay`, so no exit transition plays. Chromium keeps the element rendered through those transitions. A light dismiss's `beforetoggle` is not cancelable on any engine, so a light dismiss cannot be deferred the way a close by script can.
- **Measured on:** the dialog on Safari 27 on iOS, simulator and device, and on Safari 27 on macOS; the dialog and the popover on Playwright's WebKit 26.5. Dropped on Firefox 153. Kept on Chromium 151 and on Safari 26.6 on macOS.
- **Bug:** [WebKit 311648](https://bugs.webkit.org/show_bug.cgi?id=311648) (resolved: Safari 27 turns display transitions off for popovers and dialogs on purpose until the top-layer exit is standardized) and [WebKit 276727](https://bugs.webkit.org/show_bug.cgi?id=276727) (open: the `overlay` property and the top-layer exit algorithm); for Firefox, [Mozilla 1841456](https://bugzilla.mozilla.org/show_bug.cgi?id=1841456) (open: the `overlay` property) and [Mozilla 1971162](https://bugzilla.mozilla.org/show_bug.cgi?id=1971162) (unconfirmed: popover exit animations).
- **Repro:** [`repro/dialog-close-transition.html`](repro/dialog-close-transition.html) and [`repro/popover-light-dismiss.html`](repro/popover-light-dismiss.html). Each samples the element's computed `display` after the close; `block` at +0ms is an element kept through its exit.
- **Pin:** `a closed dialog with discrete transitions is kept through them in Chromium and dropped at once elsewhere` and `a hidden popover with discrete transitions is kept in Chromium and dropped at once elsewhere, by script and by light dismiss, and no engine lets the light dismiss be canceled`.
- **Affects:** `Dialog.Popup`, `Drawer.Popup`, and `Menu.Popup` exits.
- **Workaround:** the popup stays open until its own animations finish, then calls `close()` or `hidePopover()`, in [`components/dialog.rip`](components/dialog.rip) and [`components/menu.rip`](components/menu.rip). A light dismiss of the Menu has no exit transition on these engines; only a close through the cell waits.

## @starting-style does not substitute an unset registered property's initial value

- **Behavior:** inside `@starting-style`, a `var()` reference to a registered custom property that the element does not set is not replaced by the property's `initial-value`. The declaration is invalid at computed-value time and computes as `unset`, so a `translate` built from two such properties starts the transition from `none`: a slide to a resting position of zero runs invisibly, and one to any other position slides in from the origin instead of from the starting value. Setting the property on the element avoids it. Chromium substitutes the initial value.
- **Measured on:** Safari 27 on iOS and Playwright's WebKit 26.5. Correct on Chromium 151 and Firefox 153.
- **Bug:** [WebKit 295797](https://bugs.webkit.org/show_bug.cgi?id=295797) (open).
- **Repro:** [`repro/starting-style-registered-property.html`](repro/starting-style-registered-property.html). The page reports the transition's starting value; `200px` is correct, and WebKit reports `none` with `--ty` unset.
- **Pin:** `inside @starting-style, WebKit computes an unset registered property to nothing and other engines to its initial value`.
- **Affects:** a drawer slide built from Tailwind's `translate-x-*` or `translate-y-*` utilities, which reads both axes' registered properties.
- **Workaround:** set the other axis on the element too (`translate-y-0` for a left or right drawer, `translate-x-0` for a top or bottom one), as the README and the demo do.

## closedby is not honored everywhere

- **Behavior:** a `<dialog>` with `closedby="none"` still closes on Escape, and one with `closedby="any"` does not close on a backdrop press, where the engine does not implement the attribute. Chromium and Playwright's WebKit honor it: Escape under `none` is refused, and a press on the backdrop under `any` closes.
- **Measured on:** honored on Chromium 151, Playwright's WebKit 26.5, and Firefox 153. Not honored on Safari 27.0.1 on macOS, which has no `closedBy` on the prototype: Escape closes under `none`, and a backdrop press under `any` does nothing. The iOS browsers are unmeasured by the page.
- **Bug:** none to file; the attribute is a recent addition to the platform.
- **Repro:** [`repro/dialog-closedby.html`](repro/dialog-closedby.html). The page says whether `closedBy` exists on the prototype, and logs the `cancel` and `close` events a press causes.
- **Pin:** `closedby is honored: Escape under none is refused and a backdrop press under any closes`.
- **Affects:** `Dialog.Popup` and `Drawer.Popup`.
- **Workaround:** the popup closes itself on a press that starts and ends on the backdrop while `closedby` is `any`, and cancels Escape itself while it is `none`, in [`components/dialog.rip`](components/dialog.rip). Both go once every supported engine honors the attribute.

## The element showModal focuses shows a ring after a mouse click

- **Behavior:** after a mouse click opens a modal, the element `showModal()` focuses matches `:focus-visible` in WebKit, so it draws a focus ring a click should not produce. Chromium carries the click's state over and draws none. After a keyboard open both draw one.
- **Measured on:** Playwright's WebKit 26.5 and Safari 27.0.1 on macOS. Correct on Chromium 151 and Firefox 153.
- **Bug:** [WebKit 247416](https://bugs.webkit.org/show_bug.cgi?id=247416) (open).
- **Repro:** [`repro/modal-focus-ring.html`](repro/modal-focus-ring.html). Open the modal with a click, then with Enter; the page reports whether the focused button matches `:focus-visible`.
- **Pin:** `the element showModal focuses after a mouse click shows a ring in WebKit and none elsewhere, and a ring everywhere after Enter`.
- **Affects:** `Dialog.Popup` and `Drawer.Popup` on open.
- **Workaround:** the popup refocuses the element with `focusVisible: false` when the opener was not focus-visible, in [`components/dialog.rip`](components/dialog.rip).

## A scroll under a still pointer fires a pointermove

- **Behavior:** when content scrolls under a pointer that has not moved, by script, by wheel, or by `scrollIntoView`, every engine fires `pointerover` and `pointerenter` on the element now under it. WebKit also fires a `pointermove` at the pointer's unchanged position, and delivers all three well after the scroll rather than in the next frame.
- **Measured on:** Playwright's WebKit 26.5. Chromium 151 and Firefox 153 fire no move.
- **Bug:** none to file. WebKit dispatches the move on purpose, from a timer after a scroll, so hover follows the content (`EventHandler::dispatchFakeMouseMoveEventSoon`).
- **Repro:** [`repro/pointer-under-scroll.html`](repro/pointer-under-scroll.html). Rest the mouse over the list; it scrolls by itself and the page counts the events the rows receive.
- **Pin:** `a scroll under a still pointer fires enter on the row now under it, and in WebKit a move with no motion`.
- **Affects:** `Combobox.Item` and `Menu.Item`, which highlight the option under the pointer.
- **Workaround:** an item highlights on a pointer move only when the move reports a position other than the last one, in [`components/combobox.rip`](components/combobox.rip).

## Safari on iOS tints the strip under its bottom bar from the modal's ::backdrop

- **Behavior:** while a modal dialog is open, Safari on iOS 26 and later does not draw the page or the `::backdrop` in the strip under its translucent bottom bar. It fills the strip with a solid color guessed from the `::backdrop`'s background, blended against the page's, which it takes when the modal opens and keeps until the modal closes. A `::backdrop` that fades in is usually still transparent when the color is taken, so the strip keeps the page's color; one that appears at full color tints the strip, which then clears in one step at `close()`. The strip never follows the backdrop's transitions.
- **Measured on:** Safari 27 on iOS, simulator and device.
- **Bug:** [WebKit 300965](https://bugs.webkit.org/show_bug.cgi?id=300965) (resolved; the guess is its fix), [WebKit 303167](https://bugs.webkit.org/show_bug.cgi?id=303167) (open; the guess handles a plain color only).
- **Repro:** [`repro/modal-bar-tint.html`](repro/modal-bar-tint.html), on an iPhone or the iOS simulator.
- **Pin:** none; the strip is drawn by the browser's chrome, outside the page. Watch it on a device.
- **Affects:** every `Dialog.Popup` and `Drawer.Popup`. The demo's backdrops fade in, so the strip usually stays the page's color.
- **Workaround:** none. Dimming the strip needs page content under the bar while the modal is open, which the native modal does not allow.
