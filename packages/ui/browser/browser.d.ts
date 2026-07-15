// @rip-lang/ui/browser — the browser interaction primitives the headless
// widgets are built on. Hand-written public type surface; the implementation
// (browser/*.rip) is typed gradually and this declaration is the contract
// consumers compile against.

export type AriaEl = HTMLElement | null | undefined;

// Either an element or a lazy getter that resolves one on demand.
export type AriaElRef = AriaEl | (() => AriaEl);

export type AriaOrientation = 'vertical' | 'horizontal' | 'both';

export type Disposer = () => void;

// The semantic navigation actions `navAction` resolves a key into. `Tab` is
// intentionally not one — listNav forwards it without preventing default.
export type NavAction =
  | 'next' | 'prev' | 'first' | 'last' | 'select' | 'dismiss' | 'char';

// Keyboard handler map for listNav/rovingNav. Every key is optional; a
// handler runs only when provided. `char` receives the printable key.
export type AriaNavHandlers = {
  next?: () => void;
  prev?: () => void;
  first?: () => void;
  last?: () => void;
  select?: () => void;
  dismiss?: () => void;
  tab?: () => void;
  char?: (key: string) => void;
};

export type AriaPositionOptions = {
  placement?: string;
  offset?: number;
  matchWidth?: boolean;
};

export type AriaPopupGuard = {
  block: (ms?: number) => void;
  canOpen: () => boolean;
};

// The fields the positioning math reads off a getBoundingClientRect().
export type Rect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

export type Viewport = { width: number; height: number };

export type ParsedPlacement = {
  side: string;
  align: string;
  vertical: boolean;
  areaAlign: string;
  positionArea: string;
};

export type PlacementOpts = {
  side?: string;
  align?: string;
  offset?: number;
  matchWidth?: boolean;
};

export type BelowPosition = { left: number; top: number; minWidth: number };

export type FocusTrapMove<T> = { focus: T | null; prevent: boolean };

// DOM effects the scroll lock drives, injected so the bookkeeping is
// testable without a document.
export type ScrollLockIo = {
  scrollY: () => number;
  freeze: (scrollY: number) => void;
  release: (scrollY: number) => void;
};

export type ScrollLock = {
  lock: (instance: unknown) => void;
  unlock: (instance: unknown) => void;
  size: () => number;
};

// --- Cross-cutting helpers ---------------------------------------------

export function getRef(x: AriaElRef): AriaEl;
export function combine(...disposers: Array<Disposer | null | undefined>): Disposer;

// --- Keyboard navigation ------------------------------------------------

export function navAction(key: string, orientation?: AriaOrientation): NavAction | null;
export function rovingIndex(from: number, action: NavAction, length: number, wrap?: boolean): number;
export function listNav(e: KeyboardEvent, handlers: AriaNavHandlers): void;
export function rovingNav(e: KeyboardEvent, handlers: AriaNavHandlers, orientation?: AriaOrientation): void;

// --- Popup dismissal ----------------------------------------------------

export function outsideElements(
  target: unknown,
  els: ReadonlyArray<{ contains?(t: unknown): boolean } | null | undefined>,
): boolean;
export function popupDismiss(
  open: boolean,
  popup: AriaElRef,
  close: () => void,
  els?: AriaElRef[],
  repos?: (() => void) | null,
): Disposer | undefined;
export function popupGuard(delay?: number): AriaPopupGuard;

// --- Native top-layer binding ------------------------------------------

export function bindPopover(
  open: boolean,
  popover: AriaElRef,
  setOpen: (open: boolean) => void,
  source?: AriaElRef,
): Disposer | undefined;
export function bindDialog(
  open: boolean,
  dialog: AriaElRef,
  setOpen: (open: boolean) => void,
  dismissable?: boolean,
): Disposer | undefined;

// --- Positioning --------------------------------------------------------

export function parsePlacement(placement?: string): ParsedPlacement;
export function computePlacement(trigger: Rect, viewport: Viewport, opts?: PlacementOpts): Record<string, string>;
export function belowPosition(trigger: Rect, floating: Rect, viewport: Viewport, gap?: number): BelowPosition;
export function hasAnchor(): boolean;
export function position(trigger: AriaEl, floating: AriaEl, opts?: AriaPositionOptions): void;
export function positionBelow(trigger: AriaEl, popup: AriaEl, gap?: number, setVisible?: boolean): void;

// --- Focus management ---------------------------------------------------

export function focusTrapMove<T>(focusables: readonly T[], active: T | null, shiftKey: boolean): FocusTrapMove<T>;
export function trapFocus(panel: Element): Disposer;
export function wireAria(panel: AriaEl, id: string): void;

// --- Scroll lock --------------------------------------------------------

export function createScrollLock(io: ScrollLockIo): ScrollLock;
export function lockScroll(instance: unknown): void;
export function unlockScroll(instance: unknown): void;
