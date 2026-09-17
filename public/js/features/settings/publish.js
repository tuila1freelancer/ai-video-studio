// Publish destinations: the Facebook Page registry and the connection status.
import { $, esc } from '../../ui/dom.js';
import { api } from '../../api.js';
import { t, m, tp } from '../../i18n.js';

// Every connected Page, which one is active, and whether its token is still good (P43 — the
// registry existed since P42 but nothing showed it).
export async function loadFbPages() {
  const box = $('#pubFbPages');
  if (!box) return;
  let pages = [];
  try { pages = (await api.get('/publish/pages')).pages || []; } catch { return; }
  if (!pages.length) { box.innerHTML = `<span style="opacity:.6">${esc(t('ui.settings.chua-ket-noi-page', null, 'Chưa kết nối Page nào.'))}</span>`; return; }
  box.innerHTML = pages.map((p) => `<div>${p.active ? '🟢' : '⚪️'} <strong>${esc(p.name || p.id)}</strong>
    <button class="btn sm" data-fbsel="${esc(p.id)}">${esc(m('Dùng'))}</button>
    <button class="btn sm" data-fbchk="${esc(p.id)}">${esc(m('Kiểm tra token'))}</button>
    <button class="btn sm danger" data-fbdel="${esc(p.id)}">${esc(m('Xoá'))}</button>
    <span data-fbinfo="${esc(p.id)}"></span></div>`).join('');
  box.querySelectorAll('[data-fbsel]').forEach((b) => { b.onclick = async () => { await api.post(`/publish/pages/${b.dataset.fbsel}/select`, {}); loadFbPages(); loadPublishStatus(); }; });
  box.querySelectorAll('[data-fbdel]').forEach((b) => { b.onclick = async () => { await api.del(`/publish/pages/${b.dataset.fbdel}`); loadFbPages(); loadPublishStatus(); }; });
  box.querySelectorAll('[data-fbchk]').forEach((b) => {
    b.onclick = async () => {
      const info = box.querySelector(`[data-fbinfo="${b.dataset.fbchk}"]`);
      info.textContent = '⏳';
      const r = await api.post(`/publish/pages/${b.dataset.fbchk}/check`, {});
      info.textContent = r?.error ? `❌ ${r.error}`
        : (r.neverExpires ? m('✅ token không hết hạn') : (r.valid ? tp`✅ còn ${r.daysLeft} ngày` : m('❌ token đã hỏng')));
    };
  });
}

// Which destinations are configured/connected right now.
export async function loadPublishStatus() {
  const el = $('#pubStatus');
  if (!el) return;
  try {
    const { platforms } = await api.get('/publish/status');
    el.innerHTML = (platforms || []).map((p) =>
      `${p.connected ? '🟢' : (p.configured ? '🟡' : '⚪️')} ${esc(p.name)} — ${esc(t(
        p.connected ? 'ui.publish.da-ket-noi' : p.configured ? 'ui.publish.chua-ket-noi' : 'ui.publish.chua-cau-hinh',
        null, p.connected ? 'đã kết nối' : p.configured ? 'chưa kết nối' : 'chưa cấu hình',
      ))}`).join(' · ')
      || t('ui.publish.chua-co-nen-tang', null, 'Chưa có nền tảng nào.');
  } catch { el.textContent = t('ui.publish.khong-doc-duoc-trang-thai', null, 'Không đọc được trạng thái đăng video.'); }
}
