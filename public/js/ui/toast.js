import { $, el, esc } from './dom.js';
import { icon } from './icons.js';
import { t as translate, m } from '../i18n.js';

const KIND_ICON = { success: 'check', error: 'alert', '': 'clock' };
const MAX_STACK = 5;

// toast(msg)  ·  toast(msg, 'success')  ·  toast(msg, { kind, action: { label, fn }, ms })
//
// The message is translated HERE, keyed by its own Vietnamese text, so none of the 230 call sites
// had to change — the same gettext trick the HTTP error egress uses. A message that was built by
// interpolation cannot be looked up and keeps its Vietnamese, which is the honest fallback.
export function toast(msg, kindOrOpts = '') {
  const opts = typeof kindOrOpts === 'string' ? { kind: kindOrOpts } : (kindOrOpts || {});
  const kind = opts.kind || '';
  msg = translate(`ui.msg.${msg}`, null, msg);
  const t = el('div', 'toast ' + kind);
  t.innerHTML = `${icon(KIND_ICON[kind] ?? 'clock', 15)}<span>${msg}</span>${opts.action ? `<button class="t-act">${esc(m(opts.action.label))}</button>` : ''}`;
  if (opts.action) t.querySelector('.t-act').addEventListener('click', () => { opts.action.fn(); t.remove(); });
  const box = $('#toasts');
  box.appendChild(t);
  while (box.children.length > MAX_STACK) box.firstChild.remove();
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, opts.ms || 3600);
}
