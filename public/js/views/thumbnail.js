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

// Mirrors COMPOSITIONS in src/pipeline/thumbnail-codegen.js — the owner picks a layout brief
// instead of re-rolling the same idea and hoping for a different one.
const LAYOUTS = [
  'Chữ lớn dồn góc dưới', 'Câu móc khổng lồ giữa khung', 'Dải kicker trên đầu',
  'Trước / sau, chia đôi khung', 'Con số khổng lồ tràn mép', 'Dấu cấm đè lên thứ sai',
  'Mũi tên chỉ vào điểm nhấn', 'Khung chat hỏi đáp', 'So sánh hai cột',
  'Vật thể phát sáng giữa khung', 'Dải chéo qua khung', 'Ba chữ xếp chồng',
];
const SOURCE = { ai: 'AI dựng', 'ai-edit': 'AI sửa', hand: 'Sửa tay', template: 'Mẫu sẵn' };

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

  const cur = data.versions.find((v) => v.current) || data.versions[0] || null;
  const curUrl = cur?.url || (data.current ? `/api/file?path=${encodeURIComponent(data.current)}` : null);

  box.innerHTML = `
    <div class="thumb-panel">
      <div class="tp-head">
        <b>🖼️ Ảnh bìa</b>
        <span class="hint">${data.versions.length} phiên bản</span>
      </div>
      ${curUrl ? `<img class="tp-current" src="${esc(curUrl)}" alt="ảnh bìa đang dùng">` : '<div class="hint">Chưa có ảnh bìa — bấm “Tạo lại” để AI dựng.</div>'}
      <div class="tp-acts">
        <button class="btn xs" data-t="regen" title="AI dựng một thiết kế mới, chọn được bố cục và định hướng mỹ thuật">✨ Tạo lại</button>
        <button class="btn xs" data-t="edit" ${cur?.html ? '' : 'disabled'} title="Giữ nguyên thiết kế, chỉ đổi thứ mình nói">🪄 Sửa bằng AI</button>
        <button class="btn xs" data-t="html" ${cur?.html ? '' : 'disabled'} title="Mở mã HTML ra sửa tay rồi dựng lại">⌨️ Sửa HTML</button>
      </div>
      ${data.versions.length ? `<div class="tp-strip">${data.versions.map(stripItem).join('')}</div>` : ''}
    </div>`;

  box.querySelector('[data-t=regen]')?.addEventListener('click', () => lock(regen));
  box.querySelector('[data-t=edit]')?.addEventListener('click', () => lock(editByAi));
  box.querySelector('[data-t=html]')?.addEventListener('click', () => lock(() => editHtml(cur)));
  box.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => lock(() => useVersion(b.dataset.use))));
  box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => lock(() => delVersion(b.dataset.del))));
}

function stripItem(v) {
  const when = v.created_at ? new Date(v.created_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  const tag = SOURCE[v.source] || v.source || '';
  return `<figure class="tp-ver${v.current ? ' is-current' : ''}">
    ${v.url ? `<img src="${esc(v.url)}" loading="lazy" alt="">` : `<div class="tp-gone">ảnh không còn</div>`}
    <figcaption>
      <span class="tp-tag">${esc(tag)}</span>
      <span class="hint">${esc(when)}</span>
      ${v.instruction ? `<span class="tp-note" title="${esc(v.instruction)}">“${esc(v.instruction.slice(0, 40))}”</span>` : ''}
      <span class="tp-vacts">
        ${v.current ? '<b class="tp-cur">đang dùng</b>'
    : `${v.url ? `<button class="btn xs ghost" data-use="${esc(v.id)}">Dùng bản này</button>` : ''}
           <button class="btn xs ghost" data-del="${esc(v.id)}" title="Bỏ khỏi danh sách — ảnh vẫn còn trên đĩa">✕</button>`}
      </span>
    </figcaption>
  </figure>`;
}

/** Re-design: pick a layout brief and, optionally, say what it should look like. */
async function regen() {
  const p = state.current;
  const picked = await openDialog(`
    <div class="dlg-title">Tạo lại ảnh bìa</div>
    <div class="field"><label class="label">Bố cục</label>
      <select class="input" data-a="layout">${LAYOUTS.map((l, i) => `<option value="${i}">${esc(l)}</option>`).join('')}</select></div>
    <div class="field"><label class="label">Câu móc trên ảnh (để trống thì AI tự rút từ tiêu đề)</label>
      <input class="input" data-a="hook" placeholder="3–6 chữ, ví dụ: AI CHỈ ĐANG ĐOÁN CHỮ"></div>
    <div class="field" style="margin-bottom:16px"><label class="label">Định hướng mỹ thuật (không bắt buộc)</label>
      <input class="input" data-a="prompt" placeholder="ví dụ: nền tối, một khuôn mặt ngạc nhiên bên phải, chữ vàng"></div>
    <div class="dlg-actions">
      <button class="btn" data-a="cancel">Huỷ</button>
      <button class="btn primary" data-a="ok">Dựng</button>
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
  } catch (e) { toast(e.message || 'Dựng không được', 'err'); }
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
  } catch (e) { toast(e.message || 'AI chưa sửa được', 'err'); }
}

/** The escape hatch: when AI keeps missing the point, edit the markup directly. */
async function editHtml(cur) {
  const p = state.current;
  let html = cur?.html;
  if (!html) { try { html = (await api.get(`/projects/${p.id}/thumbnail`)).html; } catch { /* none */ } }
  if (!html) return toast('Chưa có thiết kế để sửa — tạo bằng AI trước', 'err');
  const edited = await openDialog(`
    <div class="dlg-title">Sửa HTML ảnh bìa</div>
    <div class="hint" style="margin-bottom:8px">Chỉ phần bên trong khung: một khối &lt;style&gt; rồi tới các thẻ. Không có &lt;html&gt;, không &lt;script&gt;.</div>
    <textarea class="input" data-a="html" spellcheck="false" style="width:100%;height:46vh;font-family:ui-monospace,monospace;font-size:12px;line-height:1.5">${esc(html)}</textarea>
    <div class="dlg-actions" style="margin-top:16px">
      <button class="btn" data-a="cancel">Huỷ</button>
      <button class="btn primary" data-a="ok">Dựng lại</button>
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
  } catch (e) { toast(e.message || 'HTML không dựng được', 'err'); }
}

async function useVersion(id) {
  try {
    await api.post(`/projects/${state.current.id}/thumbnails/${id}/use`, {});
    toast('Đã đổi ảnh bìa', 'ok');
    await refreshAfterChange();
  } catch (e) { toast(e.message || 'Không đổi được', 'err'); }
}

async function delVersion(id) {
  const ok = await confirmDialog({
    title: 'Bỏ phiên bản này?',
    body: 'Chỉ bỏ khỏi danh sách. Ảnh vẫn còn trong thư mục xuất.',
    okText: 'Bỏ', danger: true,
  });
  if (!ok) return;
  try {
    await api.del(`/projects/${state.current.id}/thumbnails/${id}`);
    await renderThumbPanel();
  } catch (e) { toast(e.message || 'Không bỏ được', 'err'); }
}

/** The project row carries thumb_path, so the gallery tile is stale until we re-read it. */
async function refreshAfterChange() {
  try {
    const { project } = await api.get(`/projects/${state.current.id}`);
    if (project) state.current = { ...state.current, ...project };
  } catch { /* the panel below still re-reads the versions */ }
  await renderThumbPanel();
}
