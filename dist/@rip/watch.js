// Watch: reload a static page when the edge dings /assets with its
// URL path. One source, two deliveries — served standalone at
// /@rip/watch.js (including it IS the opt-in), and bundled into the
// browser runtime, where it arms only when a script tag carries the `watch`
// attribute: <script type="module" src="/@rip/rip.min.js" watch></script>.
// A page that doesn't ask isn't listening. Dev-only by nature: where no
// /hub exists (prod posture), it tries a handful of upgrades and then goes
// permanently silent.
(() => {
  if (typeof document === 'undefined' || typeof WebSocket === 'undefined') return;
  const self = document.currentScript; // set for the classic standalone include, null in modules
  const armed = self ? /\bwatch\.js\b/.test(self.src || '') : !!document.querySelector('script[watch]');
  if (!armed || globalThis.__ripWatch) return; // both deliveries present: one observer is plenty
  globalThis.__ripWatch = true;

  const page = location.pathname;
  const hits = (paths) => Array.isArray(paths) &&
    (paths.includes(page) || (page.endsWith('/') && paths.includes(page + 'index.html')));

  // ETag captured at load; compared once per reconnect to catch a ding
  // broadcast while we were dark (reconnect-reload, minimal form).
  const tag = (r) => r.headers.get('etag') || r.headers.get('last-modified') || '';
  let mark = null;
  fetch(location.href, { method: 'HEAD', cache: 'no-store' })
    .then((r) => { mark = tag(r); }).catch(() => {});
  const recheck = () => {
    if (mark === null) return;
    fetch(location.href, { method: 'HEAD', cache: 'no-store' })
      .then((r) => { if (tag(r) !== mark) location.reload(); }).catch(() => {});
  };

  let everOpen = false; // acked at least once → reconnect forever
  let attempts = 0;

  const connect = () => {
    const scheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const ws = new WebSocket(scheme + location.host + '/hub');
    ws.onopen = () => ws.send('{"+":["/assets"],"?":"observe"}');
    ws.onmessage = (event) => {
      let frame; try { frame = JSON.parse(event.data); } catch { return; }
      for (const obj of Array.isArray(frame) ? frame : [frame]) {
        if (!obj || typeof obj !== 'object' || '<' in obj) continue; // client-originated: ignore
        if ('!' in obj) { // subscription acked — only janus can send this
          if (everOpen) recheck(); // back from the dark: did the page move?
          everOpen = true;
          attempts = 0;
        }
        if (hits(obj.touched)) location.reload();
      }
    };
    ws.onclose = () => {
      attempts += 1;
      if (!everOpen && attempts >= 6) return; // no hub here — stay silent
      setTimeout(connect, Math.min(8000, 500 * 2 ** (attempts - 1)));
    };
    ws.onerror = () => {};
  };
  connect();
})();
