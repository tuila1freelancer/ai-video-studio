import { $$ } from './dom.js';

// Generic modal behavior: any [data-close] button and backdrop click close the owning modal
// with the spring-out animation. Feature-specific buttons are wired in each feature's init*.
// Keyboard parity with dialog.js dialogs: Escape closes the topmost open modal, Tab is
// trapped inside it, and focus returns to the opener when it closes.
export function closeModal(target) {
  const m = typeof target === 'string' ? document.querySelector(target) : target;
  if (!m || !m.classList.contains('open') || m.classList.contains('closing')) return;
  m.classList.add('closing');
  setTimeout(() => {
    m.classList.remove('open', 'closing');
    m._prevFocus?.focus?.();
    m._prevFocus = null;
  }, 170);
}

function topOpenModal() {
  const open = $$('.modal-bg.open').filter((m) => !m.classList.contains('closing'));
  return open[open.length - 1] || null;
}

export function initModals() {
  $$('[data-close]').forEach((b) => b.addEventListener('click', (e) => closeModal(e.target.closest('.modal-bg'))));
  $$('.modal-bg').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); });
    // remember the opener when a feature flips the modal open (features add .open directly)
    new MutationObserver(() => {
      if (m.classList.contains('open') && !m.classList.contains('closing') && !m._prevFocus) {
        m._prevFocus = document.activeElement;
      }
    }).observe(m, { attributes: true, attributeFilter: ['class'] });
  });
  document.addEventListener('keydown', (e) => {
    const m = topOpenModal();
    if (!m) return;
    if (m.querySelector('.dlg')) return; // dynamic dialog.js dialogs run their own key handling
    if (e.key === 'Escape') { e.stopPropagation(); closeModal(m); return; }
    if (e.key === 'Tab') {
      const f = $$('button,input,textarea,select,[tabindex]', m).filter((n) => !n.disabled && n.offsetParent !== null);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (i === f.length - 1 || i === -1)) { e.preventDefault(); f[0].focus(); }
    }
  }, true);
}
