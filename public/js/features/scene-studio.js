// Scene Studio — the unified per-scene panel: live preview + dialogue re-TTS + visual
// regen + direct HTML editing + take history, all against endpoints that already power
// the scene grid (regen.js, anim-html, takes). Every action shows an inline busy state
// and never blocks the UI; every edit becomes a take (rollback is one click away).
import { $ } from '../ui/dom.js';
import { api, withLock } from '../api.js';
import { toast } from '../ui/toast.js';
import { state } from '../state.js';
import { esc } from '../ui/dom.js';

let cur = null;          // scene currently open in the studio
let htmlLoaded = false;  // template-source fetched for this open

export function initSceneStudio() {
  $('#ssTabs')?.addEventListener('click', (e) => {
    const b = e.target.closest('.gtab');
    if (b) switchTab(b.dataset.tab);
  });
  $('#ssVoiceSave')?.addEventListener('click', () => withLock($('#ssVoiceSave'), saveVoice));
  $('#ssVisualSave')?.addEventListener('click', () => withLock($('#ssVisualSave'), saveVisual));
  $('#ssHtmlApply')?.addEventListener('click', () => withLock($('#ssHtmlApply'), applyHtml));
  $('#ssHtmlReset')?.addEventListener('click', () => withLock($('#ssHtmlReset'), resetHtml));
  // P43: POST /scenes/:id/edit-html existed but nothing in the UI ever called it — the owner had
  // to hand-edit markup to change one word's colour.
  $('#ssEditAi')?.addEventListener('click', () => withLock($('#ssEditAi'), editHtmlWithAi));
  $('#ssReload')?.addEventListener('click', reloadPreview);
  // audio director wiring
  $('#ssSfxGain')?.addEventListener('input', () => { $('#ssSfxGainL').textContent = `${$('#ssSfxGain').value} dB`; });
  $('#ssSfx')?.addEventListener('change', () => {
    const a = $('#ssSfxPreview');
    const v = $('#ssSfx').value;
    a.style.display = v ? 'block' : 'none';
    if (v) a.src = '/api/file?path=' + encodeURIComponent(v);
  });
  $('#ssSfxSave')?.addEventListener('click', () => withLock($('#ssSfxSave'), saveAudio));
  $('#ssReconcat')?.addEventListener('click', () => withLock($('#ssReconcat'), async () => {
    if (!state.current) return;
    await api.post(`/projects/${state.current.id}/render`, { mode: 'concat' });
    note('🎞 Đang ghép lại video final với SFX mới — theo dõi ở trang dự án.');
    toast('Đang ghép lại video…');
  }));
  $('#ssRender')?.addEventListener('click', () => withLock($('#ssRender'), renderThisScene));
  $('#ssTakes')?.addEventListener('click', onTakeAction);
  // ⌘/Ctrl+Enter applies from inside either code editor
  ['#ssHtml', '#ssCss'].forEach((id) => $(id)?.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); $('#ssHtmlApply').click(); }
  }));
  // syntax-highlight underlay stays in lockstep with the textarea (typing + scrolling)
  $('#ssHtml')?.addEventListener('input', refreshHl);
  $('#ssHtml')?.addEventListener('scroll', () => {
    const hl = $('#ssHtmlHl'), ta = $('#ssHtml');
    if (hl && ta) { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; }
  });
  // stop preview audio when the modal closes
  document.addEventListener('click', (e) => {
    if (e.target.closest('#sceneStudioModal [data-close]') || e.target.id === 'sceneStudioModal') {
      const w = $('#ssFrameWrap'); if (w) w.innerHTML = '';
      cur = null;
    }
  });
}

export function openSceneStudio(s) {
  cur = s;
  htmlLoaded = false;
  $('#ssTitle').textContent = `Cảnh ${s.idx + 1}`;
  $('#ssVoice').value = s.voice_text || '';
  $('#ssVisual').value = s.visual_prompt || '';
  $('#ssHtml').value = '';
  refreshHl();
  $('#ssCss').value = s.props?.__custom?.css || '';
  note('');
  switchTab('voice');
  reloadPreview();
  $('#sceneStudioModal').classList.add('open');
}

// Single-pass HTML highlighter for the underlay — alternation with one replacer, so the
// injected <i> spans can never be re-matched/corrupted by a later pass.
const HL_RE = /(&lt;!--[\s\S]*?--&gt;)|(&lt;\/?[\w-]+)|(\/?&gt;)|("[^"\n]*"|'[^'\n]*')|([\w-]+)(?==)/g;
function hlHtml(src) {
  const e = String(src).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return e.replace(HL_RE, (m, cm, tag, gt, str, attr) =>
    cm ? `<i class=c>${cm}</i>` : tag ? `<i class=t>${tag}</i>` : gt ? `<i class=t>${gt}</i>`
      : str ? `<i class=s>${str}</i>` : `<i class=a>${attr}</i>`);
}
function refreshHl() {
  const hl = $('#ssHtmlHl'), ta = $('#ssHtml');
  if (hl && ta) hl.innerHTML = hlHtml(ta.value) + '\n';
}

function note(msg, isErr = false) {
  const n = $('#ssNote');
  if (n) { n.textContent = msg; n.style.color = isErr ? 'var(--danger, #ff5252)' : ''; }
}

function switchTab(tab) {
  document.querySelectorAll('#ssTabs .gtab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const panes = { voice: '#ssTabVoice', visual: '#ssTabVisual', html: '#ssTabHtml', audio: '#ssTabAudio', takes: '#ssTabTakes' };
  Object.entries(panes).forEach(([k, sel]) => { const p = $(sel); if (p) p.style.display = k === tab ? 'block' : 'none'; });
  if (tab === 'html' && !htmlLoaded) loadHtml();
  if (tab === 'audio') loadAudio();
  if (tab === 'takes') loadTakes();
}

// ---- per-scene audio director (SFX mixed at the concat stage) ----
async function loadAudio() {
  if (!cur) return;
  const sel = $('#ssSfx');
  try {
    const { items } = await api.get('/library/sfx');
    const au = cur.props?.audio || {};
    sel.innerHTML = '<option value="">— Không có SFX riêng —</option>'
      + items.map((i) => `<option value="${esc(i.path)}"${i.path === au.sfx ? ' selected' : ''}>${esc(i.name)}</option>`).join('');
    $('#ssSfxGain').value = au.sfxGain ?? 0;
    $('#ssSfxGainL').textContent = `${au.sfxGain ?? 0} dB`;
    $('#ssSfxAt').value = au.sfxAt ?? 0;
    sel.dispatchEvent(new Event('change'));
  } catch (e) { sel.innerHTML = `<option value="">✗ ${esc(e.message)}</option>`; }
}

async function saveAudio() {
  if (!cur) return;
  const sfx = $('#ssSfx').value || null;
  const props = { ...(cur.props || {}) };
  if (sfx) props.audio = { sfx, sfxGain: +$('#ssSfxGain').value || 0, sfxAt: Math.max(0, +$('#ssSfxAt').value || 0) };
  else delete props.audio;
  try {
    note('⏳ Đang lưu âm thanh cảnh…');
    await api.put(`/scenes/${cur.id}`, { props });
    await syncScene();
    note(sfx ? '✓ Đã lưu SFX — bấm "Ghép lại video" để nghe trong bản final.' : '✓ Đã bỏ SFX riêng của cảnh.');
    toast('🔊 Đã lưu âm thanh cảnh.', 'success');
  } catch (e) { note('✗ ' + e.message, true); }
}

// ---- live preview (same page the renderer uses — WYSIWYG by construction) ----
function reloadPreview() {
  if (!cur) return;
  const ar = state.current?.aspect_ratio || '9:16';
  const dims = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] }[ar] || [1080, 1920];
  const wrap = $('#ssFrameWrap');
  const maxW = Math.min(480, wrap.parentElement?.clientWidth || 480);
  const maxH = Math.min(560, window.innerHeight * 0.6);
  const scale = Math.min(maxH / dims[1], maxW / dims[0]);
  wrap.innerHTML = '';
  wrap.style.width = Math.round(dims[0] * scale) + 'px';
  wrap.style.height = Math.round(dims[1] * scale) + 'px';
  const f = document.createElement('iframe');
  f.src = `/api/scenes/${cur.id}/anim-html&cb=`.replace('&cb=', `?cb=${Date.now()}`);
  f.style.cssText = `width:${dims[0]}px;height:${dims[1]}px;transform:scale(${scale});transform-origin:0 0;border:0;display:block`;
  wrap.appendChild(f);
}

// ---- dialogue → re-TTS ----
async function saveVoice() {
  if (!cur) return;
  const text = $('#ssVoice').value.trim();
  if (text.length < 2) { note('Lời thoại quá ngắn.', true); return; }
  try {
    note('⏳ Đang lưu lời thoại + tạo lại giọng…');
    await api.put(`/scenes/${cur.id}`, { voice_text: text });
    await api.post(`/scenes/${cur.id}/regen-voice`, {});
    cur.voice_text = text;
    await syncScene();
    reloadPreview();
    note('✓ Giọng mới đã sẵn sàng — nghe lại bằng ↻.');
    toast('🎙 Đã tạo lại giọng cho cảnh.', 'success');
  } catch (e) { note('✗ ' + e.message, true); }
}

// ---- visual brief → AI regen ----
async function saveVisual() {
  if (!cur) return;
  try {
    note('⏳ AI đang dựng lại visual…');
    await api.put(`/scenes/${cur.id}`, { visual_prompt: $('#ssVisual').value.trim() });
    await api.post(`/scenes/${cur.id}/regen-html`, {});
    await syncScene();
    htmlLoaded = false; // template changed → editor must refetch
    reloadPreview();
    note('✓ Visual mới đã lên preview.');
    toast('✨ Đã dựng lại visual.', 'success');
  } catch (e) { note('✗ ' + e.message, true); }
}

// ---- direct HTML editing ----
async function loadHtml() {
  if (!cur) return;
  const st = $('#ssHtmlState');
  st.textContent = '⏳ đang tải source…';
  try {
    const src = await api.get(`/scenes/${cur.id}/template-source`);
    $('#ssHtml').value = src.html || '';
    refreshHl();
    st.textContent = src.hasCustom ? '(đang dùng bản sửa tay)' : `(template: ${src.template})`;
    htmlLoaded = true;
  } catch (e) { st.textContent = '✗ ' + e.message; }
}

async function applyHtml() {
  if (!cur) return;
  const html = $('#ssHtml').value;
  if (!html.trim()) { note('Chưa có nội dung HTML.', true); return; }
  try {
    note('⏳ Đang áp dụng bản sửa + dựng preview…');
    await api.post(`/scenes/${cur.id}/custom-html`, { html, css: $('#ssCss').value });
    await syncScene();
    $('#ssHtmlState').textContent = '(đang dùng bản sửa tay)';
    reloadPreview();
    note('✓ Đã áp dụng — cảnh sẽ render lại với markup này.');
    toast('💾 Đã áp bản sửa tay.', 'success');
  } catch (e) { note('✗ ' + e.message, true); }
}

// Describe the change in plain language; the AI applies it to THIS scene's spec and the preview
// refreshes. The old spec is kept as a take (server side), so a bad edit is one click to undo.
async function editHtmlWithAi() {
  if (!cur) return;
  const prompt = $('#ssEditPrompt')?.value.trim();
  const out = $('#ssEditOut');
  if (!prompt) { if (out) out.textContent = 'Mô tả thay đổi trước đã.'; return; }
  if (out) out.textContent = '⏳ AI đang sửa…';
  try {
    const r = await api.post(`/scenes/${cur.id}/edit-html`, { prompt });
    if (r?.error) throw new Error(r.error);
    await syncScene();
    htmlLoaded = false;
    await loadHtml();
    reloadPreview();
    if (out) out.textContent = '✓ Đã sửa — xem preview bên trái';
    toast('✏️ AI đã sửa cảnh.', 'success');
  } catch (e) {
    if (out) out.textContent = '✗ ' + e.message;
    note('✗ ' + e.message, true);
  }
}

async function resetHtml() {
  if (!cur) return;
  try {
    note('⏳ Đang trả về template gốc…');
    await api.post(`/scenes/${cur.id}/custom-html`, { reset: true });
    await syncScene();
    htmlLoaded = false;
    await loadHtml();
    reloadPreview();
    note('✓ Đã bỏ bản sửa tay.');
  } catch (e) { note('✗ ' + e.message, true); }
}

// ---- takes ----
async function loadTakes() {
  if (!cur) return;
  const box = $('#ssTakes');
  box.innerHTML = '<div class="hint">⏳ Đang tải lịch sử take…</div>';
  try {
    const { takes } = await api.get(`/scenes/${cur.id}/takes`);
    if (!takes.length) { box.innerHTML = '<div class="hint">Chưa có take nào — mỗi lần tạo lại giọng/visual sẽ lưu một take.</div>'; return; }
    box.innerHTML = takes.map((t) => `
      <div class="ss-take" data-id="${esc(t.id)}">
        <span>${t.kind === 'voice' ? '🎙' : '🎨'} ${new Date(t.created_at).toLocaleString('vi-VN')}</span>
        <span class="badge ${t.is_active ? 'done' : 'paused'}">${t.is_active ? 'Đang dùng' : 'Bản cũ'}</span>
        ${t.is_active ? '' : '<button class="btn sm" data-take="activate">↩ Dùng bản này</button>'}
      </div>`).join('');
  } catch (e) { box.innerHTML = `<div class="hint">✗ ${esc(e.message)}</div>`; }
}

async function onTakeAction(e) {
  const b = e.target.closest('button[data-take]');
  if (!b || !cur) return;
  b.disabled = true;
  try {
    await api.post(`/takes/${b.closest('.ss-take').dataset.id}/activate`, {});
    await syncScene();
    htmlLoaded = false;
    await loadTakes();
    reloadPreview();
    toast('↩ Đã khôi phục take.', 'success');
  } catch (err) { toast('✗ ' + err.message, 'error'); b.disabled = false; }
}

// ---- render just this scene (fingerprint keeps every other scene) ----
async function renderThisScene() {
  if (!cur || !state.current) return;
  await api.post(`/projects/${state.current.id}/render`, { mode: 'scenes', sceneIds: [cur.id] });
  note('🎞 Đang render riêng cảnh này — theo dõi ở lưới cảnh.');
  toast('Đang render cảnh…');
}

// refresh the in-memory scene row (and the grid card) after any studio action
async function syncScene() {
  if (!cur || !state.current) return;
  try {
    const r = await api.get('/projects/' + state.current.id);
    state.scenes = r.scenes || [];
    const fresh = state.scenes.find((x) => x.id === cur.id);
    if (fresh) cur = fresh;
    const { renderScenes } = await import('../views/scenes.js');
    renderScenes();
  } catch { /* grid refresh is cosmetic here */ }
}
