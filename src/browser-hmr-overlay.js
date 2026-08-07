// Dev-only compile/activation failure overlay. Keeps the last-known-good
// App interactive underneath; never mounts into the App target (remounts
// would wipe it). Cleared on the next successful apply or destroy.

import { __hmrEmit } from './runtime/components.js';

const ATTR = 'data-rip-hmr-overlay';

let overlayEl = null;

const failureText = error => {
  if (error == null) return 'Unknown update failure';
  if (typeof error === 'string') return error;
  return error.message || error.stack || String(error);
};

const failurePath = error => {
  if (error == null || typeof error !== 'object') return null;
  if (typeof error.path === 'string' && error.path) return error.path;
  if (typeof error.file === 'string' && error.file) return error.file;
  return null;
};

export function showHmrOverlay(kind, error) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const root = document.body || document.documentElement;
  if (!root) return null;

  clearHmrOverlay();

  const card = document.createElement('div');
  card.setAttribute(ATTR, kind || 'compile');
  card.setAttribute('role', 'alert');
  card.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483646',
    'display:flex',
    'align-items:flex-start',
    'justify-content:center',
    'padding:2rem 1rem',
    'box-sizing:border-box',
    'background:rgba(15,23,42,0.45)',
    'overflow:auto',
  ].join(';');

  const shell = document.createElement('div');
  shell.style.cssText = 'position:relative;max-width:52rem;width:100%';

  const panel = document.createElement('pre');
  panel.style.cssText = [
    'margin:0',
    'padding:1rem 1.25rem',
    'color:#b91c1c',
    'background:#fef2f2',
    'border:1px solid #fecaca',
    'border-radius:8px',
    'font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace',
    'white-space:pre-wrap',
    'overflow-wrap:anywhere',
  ].join(';');

  const title = kind === 'activate'
    ? 'Rip: update failed to activate'
    : 'Rip: update failed to compile';
  const path = failurePath(error);
  const header = path ? `${title}\n${path}\n\n` : `${title}\n\n`;
  panel.textContent = header + failureText(error);

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Dismiss';
  dismiss.style.cssText = [
    'position:absolute',
    'top:0.5rem',
    'right:0.5rem',
    'padding:0.4rem 0.75rem',
    'font:12px/1.2 system-ui,sans-serif',
    'color:#0f172a',
    'background:#fff',
    'border:1px solid #cbd5e1',
    'border-radius:6px',
    'cursor:pointer',
  ].join(';');
  dismiss.addEventListener('click', () => clearHmrOverlay());

  shell.appendChild(panel);
  shell.appendChild(dismiss);
  card.appendChild(shell);
  card.addEventListener('click', event => {
    if (event.target === card) clearHmrOverlay();
  });

  const onKey = event => {
    if (event.key === 'Escape') clearHmrOverlay();
  };
  card._ripOnKey = onKey;
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', onKey);
  }

  root.appendChild(card);
  overlayEl = card;
  __hmrEmit('reject', {
    kind: kind || 'compile',
    path: failurePath(error),
    message: failureText(error).slice(0, 500),
  });
  return card;
}

export function clearHmrOverlay() {
  if (!overlayEl) return;
  const onKey = overlayEl._ripOnKey;
  if (
    onKey &&
    typeof document !== 'undefined' &&
    typeof document.removeEventListener === 'function'
  ) {
    document.removeEventListener('keydown', onKey);
  }
  overlayEl.remove?.();
  overlayEl = null;
}

export function hmrOverlayElement() {
  return overlayEl;
}
