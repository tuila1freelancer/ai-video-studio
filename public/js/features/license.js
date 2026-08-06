// Licence: the lock screen, the plan badge, and the update banner.
//
// The lock screen is the whole product for anyone who has not paid yet, so it says what to do next
// rather than what went wrong: paste a key, or go and buy one.
import { $ } from '../ui/dom.js';
import { api, withLock } from '../api.js';
import { state } from '../state.js';

let status = null;

export function licenseStatus() { return status; }

/** `TOOLS-XXXX-XXXX-XXXX-XXXX` as the customer types. */
function formatKey(raw) {
  const clean = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = clean.startsWith('TOOLS') ? clean.slice(5) : clean;
  const groups = body.match(/.{1,4}/g) || [];
  return ['TOOLS', ...groups.slice(0, 4)].join('-');
}

function show(el, on) { if (el) el.style.display = on ? '' : 'none'; }

function renderLock() {
  const lock = $('#licenseLock');
  if (!lock) return;
  const locked = status && !status.runnable;
  lock.classList.toggle('open', Boolean(locked));
  if (!locked) return;
  $('#licenseLockMsg').textContent = status.message || 'Cần license để sử dụng app.';
  const buy = $('#btnLicenseBuy');
  show(buy, Boolean(status.storeUrl));
  // A key that is already on the machine but refused (expired, wrong device) is worth showing:
  // it tells the owner WHICH licence the message is about.
  const known = $('#licenseKnownKey');
  known.textContent = status.key ? `License hiện tại: ${status.key}` : '';
  show(known, Boolean(status.key));
}

function renderBadge() {
  const badge = $('#licenseBadge');
  if (!badge || !status) return;
  if (status.reason === 'bypass' || status.reason === 'unconfigured') { show(badge, false); return; }
  show(badge, true);
  const days = status.daysLeft;
  const plan = status.plan || 'License';
  if (status.state === 'grace') {
    badge.className = 'license-badge warn';
    badge.innerHTML = `<b>Hết hạn</b><small>còn ${days ?? 0} ngày ân hạn</small>`;
  } else if (days == null) {
    badge.className = 'license-badge';
    badge.innerHTML = `<b>${plan}</b><small>trọn đời</small>`;
  } else {
    badge.className = `license-badge${days <= 7 ? ' warn' : ''}`;
    badge.innerHTML = `<b>${plan}</b><small>còn ${days} ngày</small>`;
  }
  badge.title = `Thiết bị: ${status.deviceId || '—'}\nLicense: ${status.key || '—'}`;
}

async function renderUpdate() {
  if (!status?.runnable) return;
  let info;
  try { info = await api.get('/license/update'); } catch { return; }
  const banner = $('#updateBanner');
  if (!banner || !info.hasUpdate) return;
  $('#updateBannerText').innerHTML =
    `Có bản <b>${info.latest}</b> (bạn đang dùng ${info.current})` +
    (info.changelog ? `<small>${info.changelog}</small>` : '');
  banner.dataset.versionId = info.versionId || '';
  show(banner, true);
}

/** Pull the current verdict and repaint everything that depends on it. */
export async function refreshLicense() {
  try {
    status = await api.get('/license/status');
  } catch {
    // /license/status is never gated, so a failure here is the server being down, not a licence
    // problem. Leave the UI as it is rather than locking someone out over a hiccup.
    return status;
  }
  state.license = status;
  renderLock();
  renderBadge();
  return status;
}

/**
 * Boot step zero. Returns false when the app is locked, and the caller stops there: loading
 * channels and projects behind a lock screen only fills the console with 403s.
 */
export async function bootLicense() {
  await refreshLicense();
  if (status?.runnable) void renderUpdate();
  return Boolean(status?.runnable);
}

export function initLicense() {
  const input = $('#licenseKeyInput');
  if (input) {
    input.addEventListener('input', () => {
      const pos = input.selectionStart === input.value.length;
      input.value = formatKey(input.value);
      if (pos) input.setSelectionRange(input.value.length, input.value.length);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnLicenseActivate').click(); });
  }

  $('#btnLicenseActivate')?.addEventListener('click', (e) => withLock(e.currentTarget, async () => {
    const err = $('#licenseLockErr');
    err.textContent = '';
    try {
      status = await api.post('/license/activate', { key: $('#licenseKeyInput').value });
      state.license = status;
      renderLock();
      renderBadge();
      if (status.runnable) {
        // The server starts the job queue the moment the verdict turns; the UI just needs the
        // data it skipped while locked, and a reload is the honest way to get all of it.
        location.reload();
      }
    } catch (ex) {
      err.textContent = ex.message;
    }
  }));

  $('#btnLicenseBuy')?.addEventListener('click', () => {
    if (status?.storeUrl) window.open(`${status.storeUrl}/products/ai-video-generation`, '_blank');
  });

  $('#btnLicenseRefresh')?.addEventListener('click', (e) => withLock(e.currentTarget, async () => {
    const err = $('#licenseLockErr');
    err.textContent = '';
    try {
      status = await api.post('/license/refresh');
      state.license = status;
      renderLock();
      renderBadge();
      if (status.runnable) location.reload();
      else err.textContent = status.message || '';
    } catch (ex) { err.textContent = ex.message; }
  }));

  $('#licenseBadge')?.addEventListener('click', () => {
    if (status?.storeUrl) window.open(`${status.storeUrl}/dashboard/licenses`, '_blank');
  });

  $('#btnUpdateDownload')?.addEventListener('click', (e) => withLock(e.currentTarget, async () => {
    try {
      const versionId = $('#updateBanner').dataset.versionId || undefined;
      const { url } = await api.post('/license/update/download', { versionId });
      window.open(url, '_blank');
    } catch (ex) {
      $('#updateBannerText').textContent = ex.message;
    }
  }));

  $('#btnUpdateDismiss')?.addEventListener('click', () => show($('#updateBanner'), false));

  // Any request refused for licence reasons repaints the lock immediately — a licence revoked
  // while the app is open should not wait for the next six-hour heartbeat to become visible.
  window.addEventListener('license-required', () => { void refreshLicense(); });
}
