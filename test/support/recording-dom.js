// The in-repo document stub the component runtime tests drive
// BOTH runtimes over (-clean: no browser, no dependency — the
// recording-adapter pattern from the persistence tier, aimed at the
// DOM). It implements exactly the surface the two component runtimes
// touch: element/text/comment/fragment creation, child-list mutation
// with fragment-flattening insertBefore semantics (load-bearing for
// __reconcile's batch phases), attributes incl. toggleAttribute,
// classList, event listeners with manual bubbling, querySelector for
// the mount('body') path, and head/body roots. serialize() renders a
// subtree to a deterministic HTML-ish string so scenarios compare DOM
// SHAPE between runtimes.
//
// Deliberately NOT modeled — the negative envelope. A scenario that
// needs one of these must extend the stub DELIBERATELY (add the
// feature AND remove its line here in the same commit), never bend
// around a silent absence:
//   - automatic event.target / event.currentTarget population:
//     dispatch invokes listeners with the event object as-is, so
//     ownership-sensitive tests provide target explicitly and events
//     without one remain targetless
//   - attribute→property reflection: setAttribute('value', …) never
//     writes el.value; direct property writes are plain JS properties
//     with no attribute echo
//   - real CSS transitions: transitionend is dispatched BY scenarios,
//     never by a timer; classList changes are bookkeeping only
//   - live traversal accessors: no nextSibling/firstChild/children/
//     querySelectorAll — childNodes and the mount-path querySelector
//     ('body', '#id', tag) are the whole read surface
//   - HTML parsing: no innerHTML materialization; namespaceURI is
//     stored, never interpreted

class RNode {
  constructor(nodeType) {
    this.nodeType = nodeType;
    this.parentNode = null;
    this.childNodes = [];
  }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, ref) {
    // A DocumentFragment inserts by MOVING its children — the
    // fragment itself never enters the tree (nodeType 11 semantics
    // both runtimes' batch-create phases rely on).
    if (node.nodeType === 11) {
      for (const kid of [...node.childNodes]) this.insertBefore(kid, ref);
      return node;
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    if (ref == null) {
      this.childNodes.push(node);
    } else {
      const i = this.childNodes.indexOf(ref);
      if (i === -1) throw new Error('recording-dom: insertBefore reference is not a child');
      this.childNodes.splice(i, 0, node);
    }
    node.parentNode = this;
    return node;
  }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i === -1) throw new Error('recording-dom: removeChild of a non-child');
    this.childNodes.splice(i, 1);
    node.parentNode = null;
    return node;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(type, fn, opts) {
    this._listeners ??= new Map();
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push({ fn, once: !!(opts && opts.once) });
  }
  removeEventListener(type, fn) {
    const arr = this._listeners?.get(type);
    if (arr) this._listeners.set(type, arr.filter((l) => l.fn !== fn));
  }
  dispatchEvent(event) {
    // Manual bubbling: listeners fire on this node, then up the
    // parent chain while event.bubbles.
    let node = this;
    while (node) {
      const arr = node._listeners?.get(event.type);
      if (arr) {
        for (const l of [...arr]) {
          if (l.once) node.removeEventListener(event.type, l.fn);
          l.fn.call(node, event);
        }
      }
      if (!event.bubbles) break;
      node = node.parentNode;
    }
    return true;
  }
  get textContent() {
    if (this.nodeType === 3 || this.nodeType === 8) return this.data;
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    if (this.nodeType === 3 || this.nodeType === 8) { this.data = String(v); return; }
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (v !== '') this.appendChild(new RText(v));
  }
}

class RText extends RNode {
  constructor(data) { super(3); this.data = String(data); }
}

class RComment extends RNode {
  constructor(data) { super(8); this.data = String(data); }
}

class RElement extends RNode {
  constructor(tagName, namespaceURI = null) {
    super(1);
    this.tagName = tagName;
    this.namespaceURI = namespaceURI;
    // A plain style bag: the rest seam's style-object fork assigns
    // into el.style (bookkeeping only — never serialized).
    this.style = {};
    this.attributes = new Map();
    const classes = new Set();
    this.classList = {
      add: (...names) => { for (const n of names) classes.add(n); },
      remove: (...names) => { for (const n of names) classes.delete(n); },
      contains: (n) => classes.has(n),
      _set: classes,
    };
  }
  // className ↔ classList stay ONE store (the render DSL's static
  // class emission assigns className; serialize reads classList) —
  // internal consistency, not attribute→property reflection: the
  // class ATTRIBUTE still never syncs here.
  get className() { return [...this.classList._set].join(' '); }
  set className(v) {
    this.classList._set.clear();
    for (const n of String(v).split(/\s+/)) if (n) this.classList._set.add(n);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); }
  toggleAttribute(name, force) {
    const want = force === undefined ? !this.attributes.has(name) : !!force;
    if (want) this.attributes.set(name, '');
    else this.attributes.delete(name);
    return want;
  }
}

class RDocument {
  constructor() {
    this.head = new RElement('head');
    this.body = new RElement('body');
  }
  createElement(tagName) { return new RElement(tagName); }
  createElementNS(ns, tagName) { return new RElement(tagName, ns); }
  createTextNode(data) { return new RText(data); }
  createComment(data) { return new RComment(data); }
  createDocumentFragment() { return new RNode(11); }
  // Exactly the mount-path shapes: 'body', '#id', a tag name —
  // depth-first over body.
  querySelector(sel) {
    if (sel === 'body') return this.body;
    const match = sel.startsWith('#')
      ? (el) => el.getAttribute('id') === sel.slice(1)
      : (el) => el.tagName === sel;
    const walk = (node) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 1) {
          if (match(c)) return c;
          const hit = walk(c);
          if (hit) return hit;
        }
      }
      return null;
    };
    return walk(this.body);
  }
}

export function serialize(node) {
  if (node.nodeType === 3) return node.data;
  if (node.nodeType === 8) return `<!--${node.data}-->`;
  if (node.nodeType === 11) return node.childNodes.map(serialize).join('');
  const cls = node.classList._set.size ? ` class="${[...node.classList._set].join(' ')}"` : '';
  const attrs = [...node.attributes.entries()]
    .map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${v}"`))
    .join('');
  const kids = node.childNodes.map(serialize).join('');
  return `<${node.tagName}${cls}${attrs}>${kids}</${node.tagName}>`;
}

// Install the stub as the process's `document` (both runtimes resolve
// the bare global at call time) plus the requestAnimationFrame the
// transition helper schedules on, the `Node` base the slot projection
// tests against (`children instanceof Node` — both compilers emit the
// same ternary), and an `SVGElement` class the rest seam's class fork
// consults (`el instanceof SVGElement` — the stub never constructs
// one, so the check answers false and className applies). Returns the
// document.
export function installRecordingDOM() {
  const doc = new RDocument();
  globalThis.document = doc;
  globalThis.requestAnimationFrame ??= (cb) => setTimeout(cb, 0);
  globalThis.Node ??= RNode;
  globalThis.SVGElement ??= class SVGElement extends RElement {};
  return doc;
}
