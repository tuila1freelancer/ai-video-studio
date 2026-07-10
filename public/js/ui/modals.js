import { $$ } from './dom.js';

// Generic modal behavior: any [data-close] button and backdrop click close the owning modal
// with the spring-out animation. Feature-specific buttons are wired in each feature's init*.
export function closeModal(target) {
  const m = typeof target === 'string' ? document.querySelector(target) : target;
  if (!m || !m.classList.contains('open') || m.classList.contains('closing')) return;
  m.classList.add('closing');
  setTimeout(() => m.classList.remove('open', 'closing'), 170);
}

export function initModals() {
  $$('[data-close]').forEach((b) => b.addEventListener('click', (e) => closeModal(e.target.closest('.modal-bg'))));
  $$('.modal-bg').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); }));
}
