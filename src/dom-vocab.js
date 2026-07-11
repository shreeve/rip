// The render DSL's DOM vocabulary — static, spec-derived DATA tables
// (data, never inference from generated code).
//
//   HTML_TAGS / SVG_TAGS / TEMPLATE_TAGS — the element names the render
//     DSL recognizes as tags (TypeScript's lib.dom.d.ts tag-name maps).
//   DOM_EVENTS — the event names the bare `@click` directive shorthand
//     validates against (lib.dom.d.ts GlobalEventHandlersEventMap et
//     al.; explicit `@name:` bindings are NOT gated on this set —
//     custom events are legal DOM).
//   knownBareAttribute(tag, name) — the known-attribute
//     vocabulary: a bare identifier in element-argument position is
//     boolean-attribute shorthand ONLY when the name is a real
//     attribute for that element — the HTML GLOBAL attribute set, the
//     per-tag content attributes (the WHATWG HTML attributes index),
//     `data-`/`aria-` patterns, or (on SVG elements) the SVG attribute
//     set. Unknown bare names REJECT at the caller, positioned.

export const HTML_TAGS = new Set([
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base',
  'bdi', 'bdo', 'blockquote', 'body', 'br', 'button', 'canvas', 'caption',
  'cite', 'code', 'col', 'colgroup', 'data', 'datalist', 'dd', 'del',
  'details', 'dfn', 'dialog', 'div', 'dl', 'dt', 'em', 'embed', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'i', 'iframe', 'img',
  'input', 'ins', 'kbd', 'label', 'legend', 'li', 'link', 'main', 'map',
  'mark', 'menu', 'meta', 'meter', 'nav', 'noscript', 'object', 'ol',
  'optgroup', 'option', 'output', 'p', 'picture', 'pre', 'progress', 'q',
  'rp', 'rt', 'ruby', 's', 'samp', 'script', 'search', 'section', 'select',
  'slot', 'small', 'source', 'span', 'strong', 'style', 'sub', 'summary',
  'sup', 'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th',
  'thead', 'time', 'title', 'tr', 'track', 'u', 'ul', 'var', 'video', 'wbr',
]);

export const SVG_TAGS = new Set([
  'a', 'animate', 'animateMotion', 'animateTransform', 'circle', 'clipPath',
  'defs', 'desc', 'ellipse', 'feBlend', 'feColorMatrix',
  'feComponentTransfer', 'feComposite', 'feConvolveMatrix',
  'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight', 'feDropShadow',
  'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur',
  'feImage', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset',
  'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile',
  'feTurbulence', 'filter', 'foreignObject', 'g', 'image', 'line',
  'linearGradient', 'marker', 'mask', 'metadata', 'mpath', 'path', 'pattern',
  'polygon', 'polyline', 'radialGradient', 'rect', 'script', 'set', 'stop',
  'style', 'svg', 'switch', 'symbol', 'text', 'textPath', 'title', 'tspan',
  'use', 'view',
]);

export const TEMPLATE_TAGS = new Set([...HTML_TAGS, ...SVG_TAGS]);

export const DOM_EVENTS = new Set([
  'abort', 'animationcancel', 'animationend', 'animationiteration',
  'animationstart', 'auxclick', 'beforeinput', 'beforematch', 'beforetoggle',
  'blur', 'cancel', 'canplay', 'canplaythrough', 'change', 'click', 'close',
  'command', 'compositionend', 'compositionstart', 'compositionupdate',
  'contextlost', 'contextmenu', 'contextrestored', 'copy', 'cuechange',
  'cut', 'dblclick', 'drag', 'dragend', 'dragenter', 'dragleave', 'dragover',
  'dragstart', 'drop', 'durationchange', 'emptied', 'ended', 'error',
  'focus', 'focusin', 'focusout', 'formdata', 'fullscreenchange',
  'fullscreenerror', 'gotpointercapture', 'input', 'invalid', 'keydown',
  'keypress', 'keyup', 'load', 'loadeddata', 'loadedmetadata', 'loadstart',
  'lostpointercapture', 'mousedown', 'mouseenter', 'mouseleave',
  'mousemove', 'mouseout', 'mouseover', 'mouseup', 'paste', 'pause', 'play',
  'playing', 'pointercancel', 'pointerdown', 'pointerenter', 'pointerleave',
  'pointermove', 'pointerout', 'pointerover', 'pointerrawupdate',
  'pointerup', 'progress', 'ratechange', 'reset', 'resize', 'scroll',
  'scrollend', 'securitypolicyviolation', 'seeked', 'seeking', 'select',
  'selectionchange', 'selectstart', 'slotchange', 'stalled', 'submit',
  'suspend', 'timeupdate', 'toggle', 'touchcancel', 'touchend', 'touchmove',
  'touchstart', 'transitioncancel', 'transitionend', 'transitionrun',
  'transitionstart', 'volumechange', 'waiting', 'webkitanimationend',
  'webkitanimationiteration', 'webkitanimationstart', 'webkittransitionend',
  'wheel',
]);

// The HTML GLOBAL attributes (the WHATWG "Global attributes" list).
const GLOBAL_ATTRS = new Set([
  'accesskey', 'autocapitalize', 'autocorrect', 'autofocus', 'class',
  'contenteditable', 'dir', 'draggable', 'enterkeyhint', 'hidden', 'id',
  'inert', 'inputmode', 'is', 'itemid', 'itemprop', 'itemref', 'itemscope',
  'itemtype', 'lang', 'nonce', 'popover', 'slot', 'spellcheck', 'style',
  'tabindex', 'title', 'translate', 'writingsuggestions',
]);

// Per-tag content attributes (the WHATWG HTML attributes index),
// keyed by tag, values lowercase.
const PER_TAG_ATTRS = {
  __proto__: null,
  a: ['href', 'target', 'download', 'ping', 'rel', 'hreflang', 'type', 'referrerpolicy'],
  area: ['alt', 'coords', 'shape', 'href', 'target', 'download', 'ping', 'rel', 'referrerpolicy'],
  audio: ['src', 'crossorigin', 'preload', 'autoplay', 'loop', 'muted', 'controls'],
  base: ['href', 'target'],
  blockquote: ['cite'],
  button: ['command', 'commandfor', 'disabled', 'form', 'formaction', 'formenctype', 'formmethod', 'formnovalidate', 'formtarget', 'name', 'popovertarget', 'popovertargetaction', 'type', 'value'],
  canvas: ['width', 'height'],
  col: ['span'],
  colgroup: ['span'],
  data: ['value'],
  del: ['cite', 'datetime'],
  details: ['name', 'open'],
  dialog: ['open', 'closedby'],
  embed: ['src', 'type', 'width', 'height'],
  fieldset: ['disabled', 'form', 'name'],
  form: ['accept-charset', 'action', 'autocomplete', 'enctype', 'method', 'name', 'novalidate', 'rel', 'target'],
  iframe: ['src', 'srcdoc', 'name', 'sandbox', 'allow', 'allowfullscreen', 'width', 'height', 'referrerpolicy', 'loading'],
  img: ['alt', 'src', 'srcset', 'sizes', 'crossorigin', 'usemap', 'ismap', 'width', 'height', 'referrerpolicy', 'decoding', 'loading', 'fetchpriority'],
  input: ['accept', 'alpha', 'alt', 'autocomplete', 'checked', 'colorspace', 'dirname', 'disabled', 'form', 'formaction', 'formenctype', 'formmethod', 'formnovalidate', 'formtarget', 'height', 'list', 'max', 'maxlength', 'min', 'minlength', 'multiple', 'name', 'pattern', 'placeholder', 'popovertarget', 'popovertargetaction', 'readonly', 'required', 'size', 'src', 'step', 'type', 'value', 'width'],
  ins: ['cite', 'datetime'],
  label: ['for'],
  li: ['value'],
  link: ['href', 'crossorigin', 'rel', 'media', 'integrity', 'hreflang', 'type', 'referrerpolicy', 'sizes', 'imagesrcset', 'imagesizes', 'as', 'blocking', 'disabled', 'fetchpriority'],
  map: ['name'],
  meta: ['name', 'http-equiv', 'content', 'charset', 'media'],
  meter: ['value', 'min', 'max', 'low', 'high', 'optimum'],
  object: ['data', 'type', 'name', 'form', 'width', 'height'],
  ol: ['reversed', 'start', 'type'],
  optgroup: ['disabled', 'label'],
  option: ['disabled', 'label', 'selected', 'value'],
  output: ['for', 'form', 'name'],
  progress: ['value', 'max'],
  q: ['cite'],
  script: ['src', 'type', 'nomodule', 'async', 'defer', 'crossorigin', 'integrity', 'referrerpolicy', 'blocking', 'fetchpriority'],
  select: ['autocomplete', 'disabled', 'form', 'multiple', 'name', 'required', 'size'],
  slot: ['name'],
  source: ['type', 'media', 'src', 'srcset', 'sizes', 'width', 'height'],
  style: ['media', 'blocking'],
  td: ['colspan', 'rowspan', 'headers'],
  template: ['shadowrootmode', 'shadowrootdelegatesfocus', 'shadowrootclonable', 'shadowrootserializable'],
  textarea: ['autocomplete', 'cols', 'dirname', 'disabled', 'form', 'maxlength', 'minlength', 'name', 'placeholder', 'readonly', 'required', 'rows', 'wrap'],
  th: ['colspan', 'rowspan', 'headers', 'scope', 'abbr'],
  time: ['datetime'],
  track: ['default', 'kind', 'label', 'src', 'srclang'],
  video: ['src', 'crossorigin', 'poster', 'preload', 'autoplay', 'playsinline', 'loop', 'muted', 'controls', 'width', 'height'],
};
for (const tag in PER_TAG_ATTRS) PER_TAG_ATTRS[tag] = new Set(PER_TAG_ATTRS[tag]);

// SVG attributes (SVG 2 core + geometry + presentation + the common
// gradient/filter/animation attributes). SVG attribute names are
// case-SENSITIVE (viewBox, gradientUnits) — matched verbatim.
const SVG_ATTRS = new Set([
  'id', 'class', 'style', 'lang', 'tabindex', 'href', 'pathLength',
  'crossorigin', 'transform', 'viewBox', 'preserveAspectRatio', 'xmlns',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'width', 'height', 'd', 'points', 'dx', 'dy', 'rotate',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-opacity', 'stroke-miterlimit', 'opacity',
  'clip-path', 'clip-rule', 'mask', 'filter', 'color', 'display',
  'visibility', 'pointer-events', 'vector-effect', 'dominant-baseline',
  'text-anchor', 'font-family', 'font-size', 'font-weight', 'font-style',
  'letter-spacing', 'offset', 'stop-color', 'stop-opacity',
  'gradientUnits', 'gradientTransform', 'spreadMethod', 'patternUnits',
  'patternContentUnits', 'patternTransform', 'markerWidth', 'markerHeight',
  'refX', 'refY', 'orient', 'markerUnits', 'maskUnits', 'maskContentUnits',
  'clipPathUnits', 'filterUnits', 'primitiveUnits',
  'in', 'in2', 'result', 'stdDeviation', 'values', 'type', 'mode',
  'operator', 'radius', 'scale', 'baseFrequency', 'numOctaves', 'seed',
  'dur', 'repeatCount', 'begin', 'end', 'from', 'to', 'attributeName',
  'keyTimes', 'keySplines', 'calcMode', 'restart', 'min', 'max',
]);

// The vocabulary check for BARE-identifier boolean-attribute
// shorthand (`form noValidate` → novalidate=""). HTML attribute names
// are case-insensitive; SVG names match verbatim. `data-`/`aria-`
// names are always legal (unreachable for a bare identifier — no
// hyphen — but part of the vocabulary's contract).
// The attribute NAMES a template tag takes — the same tables
// knownBareAttribute accepts from, read as a list (the extends-props
// surface renders them as completion members; `data-`/`aria-`
// names ride the index signature instead of enumerating). Order is
// the tables' own: globals, then per-tag, then — for SVG tags — the
// SVG set (verbatim case: viewBox, fill-opacity). Tags in BOTH namespaces (a, script, style, title)
// carry both surfaces, exactly as knownBareAttribute accepts them.
export function attributeNamesFor(tag) {
  const lower = String(tag).toLowerCase();
  const names = new Set(GLOBAL_ATTRS);
  const perTag = PER_TAG_ATTRS[lower];
  if (perTag) for (const a of perTag) names.add(a);
  if (SVG_TAGS.has(String(tag))) for (const a of SVG_ATTRS) names.add(a);
  return [...names];
}

export function knownBareAttribute(tag, name) {
  const lower = String(name).toLowerCase();
  if (lower.startsWith('data-') || lower.startsWith('aria-')) return true;
  if (GLOBAL_ATTRS.has(lower)) return true;
  const perTag = PER_TAG_ATTRS[String(tag).toLowerCase()];
  if (perTag && perTag.has(lower)) return true;
  if (SVG_TAGS.has(tag) && SVG_ATTRS.has(String(name))) return true;
  return false;
}
