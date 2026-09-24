// The token screen, for a page that is not the app's own window: a server-mode instance opened in a
// browser, or a browser tab pointed at a desktop app whose owner has turned agent access on. The API
// answers 401 until a token is pasted, so the interface asks for one instead of filling the console
// with failures behind a blank page.
//
// Built in JavaScript rather than markup because it belongs to a deployment the desktop app does
// not have, and the document should not carry a panel almost nobody will ever see.
import { m } from '../i18n.js';
import { authToken, setAuthToken } from '../api.js';

let shown = false;

function overlay() {
  const wrap = document.createElement('div');
  wrap.id = 'accessGate';
  wrap.className = 'license-lock open'; // the licence screen's own styling — same job, same look
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  const card = document.createElement('div');
  card.className = 'license-card';
  const h = document.createElement('h2');
  h.textContent = m('Cần API token');
  const p = document.createElement('p');
  p.className = 'license-msg';
  p.textContent = m('Trang này cần API token: quyền cho Agent đang bật, hoặc đây là bản chạy máy chủ. Dán token vào đây — cấp ở AI Setting → Agent trên cửa sổ ứng dụng, hoặc bằng npm run token trên máy chủ.');
  const input = document.createElement('input');
  input.className = 'input license-key';
  input.type = 'password';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'avs_…';
  input.setAttribute('aria-label', m('API token'));
  const btn = document.createElement('button');
  btn.className = 'btn primary block';
  btn.textContent = m('Lưu token');
  const err = document.createElement('p');
  err.className = 'license-err';
  const save = () => {
    const value = input.value.trim();
    if (!value.startsWith('avs_')) { err.textContent = m('Token không đúng định dạng.'); return; }
    setAuthToken(value);
    location.reload(); // every module fetched behind the old answer; a clean boot is the honest way
  };
  btn.addEventListener('click', save);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  card.append(h, p, input, btn, err);
  wrap.append(card);
  return wrap;
}

/** Show the token screen once, whenever the API says it needs one. */
export function initAccess() {
  // Re-write the cookie from the remembered token: a session that predates the cookie (or a browser
  // that dropped it) would otherwise load the interface and fail on every image and font.
  if (authToken()) setAuthToken(authToken());
  window.addEventListener('token-required', () => {
    if (shown) return;
    shown = true;
    document.body.append(overlay());
    document.querySelector('#accessGate input')?.focus();
  });
}
