// The thumbnail panel.
//
// The server has been able to re-design, AI-edit and re-render a thumbnail for a long time; the
// UI never called any of it, so from the owner's chair the feature did not exist. It also kept
// exactly one design, which made "try something else" a one-way door. This panel is the missing
// half: every version a project has ever had, and four ways to make the next one.
import { $, esc } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { confirmDialog, openDialog, promptDialog } from '../ui/dialog.js';
import { m, tp } from '../i18n.js';

// Mirrors COMPOSITIONS in src/pipeline/thumbnail-codegen.js — the owner picks a layout brief
// instead of re-rolling the same idea and hoping for a different one.
// Called, not const: the catalogue lands after module evaluation, and only a literal m('…') is extractable.
const layouts = () => [
  m('Chữ lớn dồn góc dưới'), m('Câu móc khổng lồ giữa khung'), m('Dải kicker trên đầu'),
  m('Trước / sau, chia đôi khung'), m('Con số khổng lồ tràn mép'), m('Dấu cấm đè lên thứ sai'),
  m('Mũi tên chỉ vào điểm nhấn'), m('Khung chat hỏi đáp'), m('So sánh hai cột'),
  m('Vật thể phát sáng giữa khung'), m('Dải chéo qua khung'), m('Ba chữ xếp chồng'),
];
const ratios = () => [
  { id: 'youtube', label: 'YouTube 16:9' }, { id: 'facebook', label: 'Facebook' },
  { id: 'x', label: 'X / Twitter' }, { id: 'shorts', label: 'Shorts / TikTok' },
  { id: 'ig_feed', label: 'Instagram' }, { id: 'square', label: m('Vuông 1:1') },
];
const sourceLabel = (s) => ({ ai: m('AI dựng'), 'ai-edit': m('AI sửa'), hand: m('Sửa tay'), template: m('Mẫu sẵn') })[s] || s || '';

let busy = false;
const lock = async (fn) => {
  if (busy) return;
  busy = true;
  try { await fn(); } finally { busy = false; }
};

export async function renderThumbPanel() {
  const box = $('#thumbCard');
  if (!box) return;
  const p = state.current;
  if (!p?.id) { box.innerHTML = ''; return; }

  let data = { versions: [], current: null };
  try { data = await api.get(`/projects/${p.id}/thumbnails`); } catch { box.innerHTML = ''; return; }
  // The six platform covers live in metadata, not in the version table — they are a different
  // artefact (one design per ratio) and each ratio can now be redone on its own.
  let covers = [];
  try { covers = (await api.get(`/projects/${p.id}`)).project?.metadata?.covers || []; } catch { /* none yet */ }

  const cur = data.versions.find((v) => v.current) || data.versions[0] || null;
  const curUrl = cur?.url || (data.current ? `/api/file?path=${encodeURIComponent(data.current)}` : null);

  box.innerHTML = `
    <div class="thumb-panel">
      <div class="tp-head">
        <b>${m('🖼️ Ảnh bìa')}</b>
        <span class="hint">${tp`${data.versions.length} phiên bản`}</span>
      </div>
      ${curUrl ? `<img class="tp-current" src="${esc(curUrl)}" alt="${esc(m('ảnh bìa đang dùng'))}">` : `<div class="hint">${m('Chưa có ảnh bìa — bấm “Tạo lại” để AI dựng.')}</div>`}
      <div class="tp-acts">
        <button class="btn xs" data-t="regen" title="${esc(m('AI dựng một thiết kế mới, chọn được bố cục và định hướng mỹ thuật'))}">${m('✨ Tạo lại')}</button>
        <button class="btn xs" data-t="edit" ${cur?.html ? '' : 'disabled'} title="${esc(m('Giữ nguyên thiết kế, chỉ đổi thứ mình nói'))}">${m('🪄 Sửa bằng AI')}</button>
        <button class="btn xs" data-t="html" ${cur?.html ? '' : 'disabled'} title="${esc(m('Mở mã HTML ra sửa tay rồi dựng lại'))}">${m('⌨️ Sửa HTML')}</button>
      </div>
      ${data.versions.length ? `<div class="tp-strip">${data.versions.map(stripItem).join('')}</div>` : ''}
      <div class="tp-covers">
        <div class="tp-head" style="margin:12px 0 8px">
          <b>${m('Ảnh bìa theo tỉ lệ')}</b>
          <span class="hint">${covers.length}/6</span>
          <button class="btn xs ghost" data-cov="*" title="${esc(m('Dựng lại cả sáu khổ'))}">${m('Dựng lại tất cả')}</button>
        </div>
        <div class="tp-strip">${(covers.length ? covers : ratios()).map(coverItem).join('')}</div>
      </div>
    </div>`;

  box.querySelector('[data-t=regen]')?.addEventListener('click', () => lock(regen));
  box.querySelector('[data-t=edit]')?.addEventListener('click', () => lock(editByAi));
  box.querySelector('[data-t=html]')?.addEventListener('click', () => lock(() => editHtml(cur)));
  box.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => lock(() => useVersion(b.dataset.use))));
  box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => lock(() => delVersion(b.dataset.del))));
  box.querySelectorAll('[data-cov]').forEach((b) => b.addEventListener('click', () => lock(() => regenCovers(b.dataset.cov))));
}

function stripItem(v) {
  const when = v.created_at ? new Date(v.created_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  const tag = sourceLabel(v.source);
  return `<figure class="tp-ver${v.current ? ' is-current' : ''}">
    ${v.url ? `<img src="${esc(v.url)}" loading="lazy" alt="">` : `<div class="tp-gone">${m('ảnh không còn')}</div>`}
    <figcaption>
      <span class="tp-tag">${esc(tag)}</span>
      <span class="hint">${esc(when)}</span>
      ${v.instruction ? `<span class="tp-note" title="${esc(v.instruction)}">“${esc(v.instruction.slice(0, 40))}”</span>` : ''}
      <span class="tp-vacts">
        ${v.current ? `<b class="tp-cur">${m('đang dùng')}</b>`
    : `${v.url ? `<button class="btn xs ghost" data-use="${esc(v.id)}">${m('Dùng bản này')}</button>` : ''}
           <button class="btn xs ghost" data-del="${esc(v.id)}" title="${esc(m('Bỏ khỏi danh sách — ảnh vẫn còn trên đĩa'))}">✕</button>`}
      </span>
    </figcaption>
  </figure>`;
}

function coverItem(c) {
  const url = c.path ? `/api/file?path=${encodeURIComponent(c.path)}` : null;
  const label = c.label || ratios().find((r) => r.id === c.id)?.label || c.id;
  return `<figure class="tp-ver">
    ${url ? `<img src="${esc(url)}" loading="lazy" alt="">` : `<div class="tp-gone">${m('chưa có')}</div>`}
    <figcaption>
      <span class="tp-tag">${esc(m(label))}</span>
      <span class="tp-vacts"><button class="btn xs ghost" data-cov="${esc(c.id)}">${m('Dựng lại khổ này')}</button></span>
    </figcaption>
  </figure>`;
}

/** One ratio, or all six. Redoing all six to fix one throws away five the owner may like. */
async function regenCovers(which) {
  const p = state.current;
  const all = which === '*';
  const prompt = await promptDialog({
    title: all ? m('Dựng lại cả sáu khổ ảnh bìa') : tp`Dựng lại khổ ${which}`,
    label: 'Định hướng mỹ thuật (để trống thì AI tự quyết)',
    placeholder: 'ví dụ: một khuôn mặt ngạc nhiên bên phải, chữ vàng cực lớn, nền tối',
    okText: 'Dựng',
  });
  if (prompt === null) return; // cancelled; an empty string is a deliberate "you decide"
  toast(all ? m('Đang dựng sáu khổ…') : m('Đang dựng…'));
  try {
    await api.post(`/projects/${p.id}/covers/regen`, { fresh: true, prompt, ...(all ? {} : { only: [which] }) });
    toast('Đã dựng xong', 'ok');
    await renderThumbPanel();
  } catch (e) { toast(e.message || m('Dựng không được'), 'err'); }
}

/** Re-design: pick a layout brief and, optionally, say what it should look like. */
async function regen() {
  const p = state.current;
  const picked = await openDialog(`
    <div class="dlg-title">${m('Tạo lại ảnh bìa')}</div>
    <div class="field"><label class="label">${m('Bố cục')}</label>
      <select class="input" data-a="layout">${layouts().map((l, i) => `<option value="${i}">${esc(l)}</option>`).join('')}</select></div>
    <div class="field"><label class="label">${m('Câu móc trên ảnh (để trống thì AI tự rút từ tiêu đề)')}</label>
      <input class="input" data-a="hook" placeholder="${esc(m('3–6 chữ, ví dụ: AI CHỈ ĐANG ĐOÁN CHỮ'))}"></div>
    <div class="field" style="margin-bottom:16px"><label class="label">${m('Định hướng mỹ thuật (không bắt buộc)')}</label>
      <input class="input" data-a="prompt" placeholder="${esc(m('ví dụ: nền tối, một khuôn mặt ngạc nhiên bên phải, chữ vàng'))}"></div>
    <div class="dlg-actions">
      <button class="btn" data-a="cancel">${m('Huỷ')}</button>
      <button class="btn primary" data-a="ok">${m('Dựng')}</button>
    </div>`, {
    onReady(dlg, close) {
      dlg.querySelector('[data-a=cancel]').addEventListener('click', () => close(null));
      dlg.querySelector('[data-a=ok]').addEventListener('click', () => close({
        variant: +dlg.querySelector('[data-a=layout]').value,
        hook: dlg.querySelector('[data-a=hook]').value.trim(),
        prompt: dlg.querySelector('[data-a=prompt]').value.trim(),
      }));
    },
  });
  if (!picked) return;
  toast('Đang dựng ảnh bìa…');
  try {
    await api.post(`/projects/${p.id}/thumbnail/regen`, picked);
    toast('Đã dựng bản mới', 'ok');
    await refreshAfterChange();
  } catch (e) { toast(e.message || m('Dựng không được'), 'err'); }
}

/** Edit by instruction — keeps everything the owner already liked. */
async function editByAi() {
  const p = state.current;
  const prompt = await promptDialog({
    title: 'Sửa ảnh bìa bằng AI',
    label: 'Nói rõ đổi cái gì — càng cụ thể càng đúng',
    placeholder: 'chữ to hơn, bỏ mấy nhãn tiếng Anh, đổi nền sang tím',
    okText: 'Sửa',
  });
  if (!prompt) return;
  toast('Đang sửa…');
  try {
    await api.post(`/projects/${p.id}/thumbnail/edit-html`, { prompt });
    toast('Đã sửa', 'ok');
    await refreshAfterChange();
  } catch (e) { toast(e.message || m('AI chưa sửa được'), 'err'); }
}

/** The escape hatch: when AI keeps missing the point, edit the markup directly. */
async function editHtml(cur) {
  const p = state.current;
  let html = cur?.html;
  if (!html) { try { html = (await api.get(`/projects/${p.id}/thumbnail`)).html; } catch { /* none */ } }
  if (!html) return toast('Chưa có thiết kế để sửa — tạo bằng AI trước', 'err');
  const edited = await openDialog(`
    <div class="dlg-title">${m('Sửa HTML ảnh bìa')}</div>
    <div class="hint" style="margin-bottom:8px">${m('Chỉ phần bên trong khung: một khối &lt;style&gt; rồi tới các thẻ. Không có &lt;html&gt;, không &lt;script&gt;.')}</div>
    <textarea class="input" data-a="html" spellcheck="false" style="width:100%;height:46vh;font-family:ui-monospace,monospace;font-size:12px;line-height:1.5">${esc(html)}</textarea>
    <div class="dlg-actions" style="margin-top:16px">
      <button class="btn" data-a="cancel">${m('Huỷ')}</button>
      <button class="btn primary" data-a="ok">${m('Dựng lại')}</button>
    </div>`, {
    onReady(dlg, close) {
      const ta = dlg.querySelector('[data-a=html]');
      dlg.querySelector('[data-a=cancel]').addEventListener('click', () => close(null));
      dlg.querySelector('[data-a=ok]').addEventListener('click', () => close(ta.value.trim() || null));
      ta.focus();
    },
  });
  if (!edited || edited === html) return;
  toast('Đang dựng lại…');
  try {
    await api.post(`/projects/${p.id}/thumbnail/regen`, { html: edited });
    toast('Đã dựng bản sửa tay', 'ok');
    await refreshAfterChange();
  } catch (e) { toast(e.message || m('HTML không dựng được'), 'err'); }
}

async function useVersion(id) {
  try {
    await api.post(`/projects/${state.current.id}/thumbnails/${id}/use`, {});
    toast('Đã đổi ảnh bìa', 'ok');
    await refreshAfterChange();
  } catch (e) { toast(e.message || m('Không đổi được'), 'err'); }
}

async function delVersion(id) {
  const ok = await confirmDialog({
    title: 'Bỏ phiên bản này?',
    body: 'Chỉ bỏ khỏi danh sách. Ảnh vẫn còn trong thư mục xuất.',
    okText: m('Bỏ'), danger: true,
  });
  if (!ok) return;
  try {
    await api.del(`/projects/${state.current.id}/thumbnails/${id}`);
    await renderThumbPanel();
  } catch (e) { toast(e.message || m('Không bỏ được'), 'err'); }
}

/** The project row carries thumb_path, so the gallery tile is stale until we re-read it. */
async function refreshAfterChange() {
  try {
    const { project } = await api.get(`/projects/${state.current.id}`);
    if (project) state.current = { ...state.current, ...project };
  } catch { /* the panel below still re-reads the versions */ }
  await renderThumbPanel();
}
