// <script type="text/rip"> loading. Every script source on a page —
// data-src listed bundles, inline text, and src fetches — concatenates
// into ONE program compiled in script mode and run as one async
// closure, so the page's scripts genuinely share a scope: a later
// script reads earlier bindings, reactive state crosses directly, and
// re-spelling `name = value` assigns instead of colliding. Module
// forms reject at their own positions (script tags are not modules);
// the compiler owns that judgment, so string content that merely looks
// like a module form is never touched.
//
// The DOM, network, and eval seams arrive through an injectable host,
// so the loader tests under Node and the browser default is one small
// adapter. Failure posture: a script that fails to compile is reported
// with its own label and local position and DROPPED — the rest of the
// page recompiles and runs. A duplicate source rejects the load
// loudly. Evaluation requires eval capability: a CSP that blocks
// FUNCTION CONSTRUCTION produces one loud diagnostic naming the
// unsafe-eval requirement; an error thrown by running user code is the
// page's own and reports as such.
import { compile } from './compile.js';
import { runtimes } from './browser-runtimes.js';

const scopeNames = Object.keys(runtimes);
const scopeValues = scopeNames.map(name => runtimes[name]);

const browserHost = () => {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') {
    throw new Error('rip: processRipScripts requires a browser or an injected host');
  }
  return {
    scripts() {
      return Array.from(document.querySelectorAll('script[type="text/rip"]')).map(node => ({
        src: node.getAttribute('src'),
        text: node.textContent ?? '',
      }));
    },
    async fetchText(url) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.text();
    },
    prepare(code, names) {
      return new Function(...names, code);
    },
    async ready() {
      if (document.readyState === 'loading') {
        await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
      }
    },
    report(error) {
      // The diagnostic lives in the message TEXT: some consoles
      // (Firefox) render an Error argument as its class name alone.
      console.error('[Rip]', String(error));
    },
  };
};

// Strip the longest common indentation PREFIX so inline script bodies
// survive their markup's indentation. Prefixes compare as strings: a
// tab/space disagreement means there is no honest common indent, so
// nothing strips.
const dedent = text => {
  const lines = text.split('\n');
  let prefix = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const lead = line.match(/^[ \t]*/)[0];
    if (prefix === null) {
      prefix = lead;
      continue;
    }
    let shared = 0;
    while (shared < prefix.length && shared < lead.length && prefix[shared] === lead[shared]) shared += 1;
    prefix = prefix.slice(0, shared);
    if (!prefix) return text;
  }
  if (!prefix) return text;
  return lines.map(line => (line.trim() ? line.slice(prefix.length) : line)).join('\n');
};

// Duplicate claims compare resolved URLs, not spellings: '/a.rip' and
// './a.rip' are the same source. Query strings stay distinct — cache
// busting the same path twice is a deliberate act.
const claimKey = label => {
  try {
    return new URL(label, 'https://rip.invalid/').href;
  } catch {
    return label;
  }
};

export async function processRipScripts(host = null) {
  const h = host ?? browserHost();
  await h.ready?.();

  const sources = [];
  const seen = new Set();
  const claim = label => {
    const key = claimKey(label);
    if (seen.has(key)) {
      throw new Error(`rip: script source '${label}' is listed more than once`);
    }
    seen.add(key);
  };

  for (const url of h.dataSrc?.() ?? []) {
    claim(url);
    sources.push({ label: url, text: null, url });
  }
  let ordinal = 0;
  for (const script of h.scripts?.() ?? []) {
    ordinal += 1;
    if (script.src) {
      claim(script.src);
      sources.push({ label: script.src, text: null, url: script.src });
    } else {
      sources.push({ label: `<script:${ordinal}>`, text: dedent(script.text ?? '') });
    }
  }

  const failures = [];
  const report = (label, error) => {
    failures.push({ label, error });
    h.report?.(error);
  };

  const loaded = [];
  for (const source of sources) {
    if (source.text !== null) {
      loaded.push(source);
      continue;
    }
    if (typeof h.fetchText !== 'function') {
      throw new Error("rip: this host loads script sources by URL but provides no fetchText");
    }
    try {
      loaded.push({ ...source, text: await h.fetchText(source.url) });
    } catch (error) {
      report(source.label, new Error(`rip: failed to load '${source.label}': ${error.message}`));
    }
  }

  // One program: concatenated sources with recorded line offsets, so a
  // compile error maps back to its own script and local line. The
  // failing script drops and the rest recompile — a page never dies
  // for one bad tag.
  let active = loaded;
  let compiled = null;
  while (active.length) {
    const offsets = [];
    let line = 1;
    const parts = [];
    for (const source of active) {
      offsets.push({ source, start: line });
      const text = source.text.endsWith('\n') ? source.text.slice(0, -1) : source.text;
      parts.push(text);
      line += text.split('\n').length;
    }
    try {
      compiled = compile(parts.join('\n'), { path: '<scripts>', runtimeDelivery: 'none', script: true });
      break;
    } catch (error) {
      let owner = offsets[0];
      for (const entry of offsets) {
        if (typeof error.line === 'number' && entry.start <= error.line) owner = entry;
      }
      const local = typeof error.line === 'number' ? error.line - owner.start + 1 : null;
      const framed = new Error(
        `rip: ${owner.source.label}${local ? `:${local}` : ''} failed to compile: ${error.message}`,
      );
      framed.cause = error;
      framed.line = local;
      framed.col = error.col;
      report(owner.source.label, framed);
      active = active.filter(source => source !== owner.source);
      compiled = null;
    }
  }

  let executed = false;
  if (compiled) {
    const program = `'use strict';\nreturn (async () => {\n${compiled.code}\n})();`;
    let fn = null;
    try {
      fn = h.prepare(program, scopeNames);
    } catch (error) {
      const csp = new Error(
        "rip: script evaluation is blocked by Content Security Policy — running Rip from script tags requires 'unsafe-eval' " +
        '(script-src). Serve precompiled JavaScript or relax the policy for this page.',
      );
      csp.cause = error;
      report('<evaluate>', csp);
    }
    if (fn) {
      try {
        await fn(...scopeValues);
        executed = true;
      } catch (error) {
        // The page's own code threw: report it as the page's error —
        // scripts after the throwing statement never ran.
        report('<runtime>', error);
      }
    }
  }

  return { count: active.length, executed, failures };
}
