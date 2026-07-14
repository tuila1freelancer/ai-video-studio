import { $, $$, el, esc, statusIcon } from '../ui/dom.js';
import { closeModal } from '../ui/modals.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { api, fileUrl } from '../api.js';
import { state } from '../state.js';
import { prog, markProgressDirty } from './progress.js';
import { openSceneStudio } from '../features/scene-studio.js';

// perf instrumentation (asserted by the stress gate: fullRenders must not grow during WS bursts)
export const scenePerf = { fullRenders: 0, patches: 0 };

export function initScenes() {
  $('#propSave').addEventListener('click', savePropsEditor);
  wireGrid();
  // stop audio when the live modal closes
  document.addEventListener('click', (e) => {
    if (e.target.closest('#liveModal [data-close]') || e.target.id === 'liveModal') {
      const w = $('#liveWrap'); if (w) w.innerHTML = '';
    }
  });
}

// ---- delegation: exactly 4 listeners on the grid, regardless of scene count ----
function sceneOf(node) {
  const card = node.closest('.scene');
  return card ? [card, state.scenes.find((x) => String(x.id) === card.dataset.id)] : [null, null];
}
function wireGrid() {
  const grid = $('#sceneGrid');
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const [, s] = sceneOf(btn); if (!s) return;
    const act = btn.dataset.act;
    if (act === 'live') openLivePreview(s);
    else if (act === 'studio') openSceneStudio(s);
    else if (act === 'edit') openPropsEditor(s);
    else if (act === 'voice') regenScene(s.id, 'voice');
    else if (act === 'html') regenScene(s.id, 'html');
    else if (act === 'render') renderScenes2('scenes', [s.id]);
  });
  grid.addEventListener('change', async (e) => {
    const [card, s] = sceneOf(e.target); if (!s) return;
    if (e.target.classList.contains('chk')) {
      card.classList.toggle('sel', e.target.checked);
      updateSelCount();
    } else if (e.target.classList.contains('tpl-sel')) {
      const sel = e.target;
      await api.put('/scenes/' + s.id, { template: sel.value });
      toast('Đang tạo preview…');
      const r = await api.post(`/scenes/${s.id}/preview-frame`, {});
      if (r.image) {
        s.template = sel.value;
        s.image_path = decodeURIComponent(r.image.split('path=')[1] || '');
        card.dataset.img = ''; // force poster refresh
        patchScene(card, s);
      }
    }
  });
  // hover-play: src is assigned on demand and released on leave — idle videos hold no decoder.
  // mouseover/mouseout bubble (mouseenter does not); relatedTarget guards inner moves.
  grid.addEventListener('mouseover', (e) => {
    const sv = e.target.closest('.sv'); if (!sv || sv.contains(e.relatedTarget)) return;
    const v = sv.querySelector('video'); if (!v) return;
    if (!v.getAttribute('src') && v.dataset.src) v.src = v.dataset.src;
    v.play().catch(() => {});
  });
  grid.addEventListener('mouseout', (e) => {
    const sv = e.target.closest('.sv'); if (!sv || sv.contains(e.relatedTarget)) return;
    const v = sv.querySelector('video'); if (!v) return;
    v.pause(); v.removeAttribute('src'); v.load();
  });
}

// ---- rendering ----
export function renderScenes() {
  const grid = $('#sceneGrid');
  $('#sceneToolbar').classList.toggle('hidden', !state.scenes.length);
  if (!state.scenes.length) { grid.innerHTML = ''; return; }
  scenePerf.fullRenders++;
  const frag = document.createDocumentFragment();
  state.scenes.forEach((s) => frag.appendChild(sceneCard(s)));
  grid.replaceChildren(frag);
  updateSelCount();
}

function sceneCard(s) {
  const c = el('div', 'scene'); c.dataset.id = s.id;
  const imgUrl = s.image_path ? fileUrl(s.image_path) : '';
  c.dataset.img = imgUrl;
  const poster = imgUrl ? `<img src="${imgUrl}" loading="lazy" decoding="async">` : `<div class="ph">${icon('film', 24)}</div>`;
  const vid = s.video_path ? `<video data-src="${fileUrl(s.video_path)}" muted loop playsinline preload="none"></video>` : '';
  const mode = state.current?.config?.visualMode || 'animation';
  const isAnim = mode === 'animation';
  const isHf = mode === 'hyperframe';
  const animLike = mode !== 'image'; // animation + hyperframe: GSAP page → live preview works
  const tplSelect = isAnim && state.templates.length
    ? `<select class="input tpl-sel" title="Đổi template">${state.templates.map((t) =>
        `<option value="${t.id}"${t.id === s.template ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`
    : '';
  const nBeats = s.hfBeats ?? (Array.isArray(s.props?.beats) ? s.props.beats.length : null);
  const hfBadge = isHf && s.template === 'hyperframe' && nBeats
    ? ` <span class="hf-badge" title="visual bám theo ${nBeats} beat của lời thoại">✨${nBeats}</span>` : '';
  c.innerHTML = `<div class="sv"><input type="checkbox" class="chk">${poster}${vid}${s.duration ? (() => { const voiced = s.audio_path || ['tts', 'rendered'].includes(s.status); return `<span class="dur"${voiced ? '' : ' title="thời lượng ước lượng — sẽ chốt khi lồng tiếng"'}>${voiced ? '' : '~'}${s.duration.toFixed(1)}s</span>`; })() : ''}</div>
    <div class="si"><div class="n"><span>Cảnh ${s.idx + 1}${hfBadge}</span><span>${statusIcon(s.status)}</span></div><div class="vt">${esc(s.voice_text || '')}</div>${tplSelect}</div>
    <div class="sa">
      ${animLike ? `<button class="btn sm" data-act="studio" title="Scene Studio: xem trước + sửa lời thoại/visual/HTML">🎬</button>` : ''}
      ${animLike ? `<button class="btn sm" data-act="live" title="Xem trước animation + tiếng">${icon('play', 13)}</button>` : ''}
      ${isAnim ? `<button class="btn sm" data-act="edit" title="Sửa chữ trên cảnh">${icon('edit', 13)}</button>` : ''}
      <button class="btn sm" data-act="voice" title="Tạo lại giọng">${icon('mic', 13)}</button>
      <button class="btn sm" data-act="html" title="${isHf ? 'AI dựng lại visual cảnh này' : 'Tạo lại cảnh'}">${icon('wand', 13)}</button>
      <button class="btn sm warn" data-act="render" title="Render cảnh">${icon('film', 13)}</button>
    </div>`;
  return c;
}

// Targeted patch — updates only the nodes whose backing data changed. Never rebuilds the card.
export function patchScene(card, s) {
  scenePerf.patches++;
  const st = card.querySelector('.si .n span:last-child');
  if (st && st.textContent !== statusIcon(s.status)) st.textContent = statusIcon(s.status);
  const sv = card.querySelector('.sv');
  if (s.duration) {
    let dur = sv.querySelector('.dur');
    if (!dur) { dur = el('span', 'dur'); sv.appendChild(dur); }
    // WS scene events never carry audio_path — a post-TTS status is the voiced signal
    const voiced = s.audio_path || ['tts', 'rendered'].includes(s.status);
    const txt = (voiced ? '' : '~') + s.duration.toFixed(1) + 's';
    if (dur.textContent !== txt) { dur.textContent = txt; if (voiced) dur.removeAttribute('title'); }
  }
  const imgUrl = s.image_path ? fileUrl(s.image_path) : '';
  if (imgUrl && card.dataset.img !== imgUrl) {
    card.dataset.img = imgUrl;
    let img = sv.querySelector('img');
    if (!img) {
      sv.querySelector('.ph')?.remove();
      img = el('img'); img.loading = 'lazy'; img.decoding = 'async';
      sv.insertBefore(img, sv.querySelector('video'));
    }
    img.src = imgUrl;
  }
  const vidUrl = s.video_path ? fileUrl(s.video_path) : '';
  let v = sv.querySelector('video');
  if (vidUrl && !v) {
    v = document.createElement('video');
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'none';
    v.dataset.src = vidUrl;
    sv.appendChild(v);
  } else if (vidUrl && v && v.dataset.src !== vidUrl) {
    v.dataset.src = vidUrl;
    if (v.getAttribute('src')) v.src = vidUrl; // currently hover-playing → swap live
  }
  const sel = card.querySelector('.tpl-sel');
  if (sel && s.template && sel.value !== s.template) sel.value = s.template;
  // HyperFrame beat badge (appears once B5 assigns the AI spec)
  const nBeats = s.hfBeats ?? (Array.isArray(s.props?.beats) ? s.props.beats.length : null);
  if (nBeats && s.template === 'hyperframe') {
    const nameSpan = card.querySelector('.si .n span:first-child');
    let b = nameSpan?.querySelector('.hf-badge');
    const txt = `✨${nBeats}`;
    if (nameSpan && !b) { b = el('span', 'hf-badge'); b.title = `visual bám theo ${nBeats} beat của lời thoại`; nameSpan.appendChild(document.createTextNode(' ')); nameSpan.appendChild(b); }
    if (b && b.textContent !== txt) b.textContent = txt;
  }
}

export async function refreshScenes() {
  if (!state.current) return;
  try { const r = await api.get('/projects/' + state.current.id); state.scenes = r.scenes || []; renderScenes(); } catch { /* ignore */ }
}
export function selectedIds() { return $$('#sceneGrid .scene.sel').map((c) => c.dataset.id); }
export function updateSelCount() {
  const n = selectedIds().length;
  $('#selCount').textContent = n ? `(${n})` : '';
  ['#btnRegenVoiceSel', '#btnRegenHtmlSel', '#btnRenderSel'].forEach((id) => $(id).disabled = !n);
}
export async function regenScene(id, what) {
  toast(`Đang tạo lại ${what === 'voice' ? 'giọng' : 'cảnh'}…`);
  await api.post(`/scenes/${id}/regen-${what}`, {});
}
export async function renderScenes2(mode, ids) {
  if (!state.current) return;
  await api.post(`/projects/${state.current.id}/render`, { mode, sceneIds: ids || [] });
  toast('Đang render…');
}

// ---- WS coalescing: burst of 'scene' messages → one patch pass per 80ms window ----
const pendingScene = new Map();
let flushTimer = null;
export function onSceneUpdate(m) {
  if (m.status && prog.counts[m.status] !== undefined) { prog.counts[m.status]++; markProgressDirty(); }
  pendingScene.set(m.sceneId, { ...(pendingScene.get(m.sceneId) || {}), ...m });
  if (!flushTimer) flushTimer = setTimeout(flushSceneUpdates, 80);
}
// Called on the 80ms timer AND immediately on step/status/done/error (terminal states never wait).
export async function flushSceneUpdates() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (!pendingScene.size) return;
  const batch = [...pendingScene.values()];
  pendingScene.clear();
  let needFull = false;
  for (const m of batch) {
    const s = state.scenes.find((x) => x.id === m.sceneId);
    if (!s) { needFull = true; continue; }
    if (m.image) s.image_path = decodeURIComponent(m.image.split('path=')[1] || '');
    if (m.video) s.video_path = decodeURIComponent(m.video.split('path=')[1] || '');
    if (m.duration) s.duration = m.duration;
    if (m.status) s.status = m.status;
    if (m.template) s.template = m.template;
    if (m.beats != null) s.hfBeats = m.beats;
    const card = document.querySelector(`#sceneGrid .scene[data-id="${m.sceneId}"]`);
    if (card) patchScene(card, s); else needFull = true;
  }
  if (needFull && state.current) {
    const r = await api.get('/projects/' + state.current.id);
    state.scenes = r.scenes || [];
    renderScenes();
  }
}

// ---------------- scene props editor ----------------
let propsScene = null;
export function openPropsEditor(s) {
  propsScene = s;
  const p = s.props || {};
  $('#propHeading').value = p.heading || '';
  $('#propSub').value = p.sub || '';
  $('#propLabel').value = p.label || '';
  $('#propJson').value = JSON.stringify(p, null, 2);
  $('#propsModal').classList.add('open');
}
async function savePropsEditor() {
  if (!propsScene) return;
  let props;
  try { props = JSON.parse($('#propJson').value || '{}'); }
  catch { toast('Props JSON không hợp lệ.', 'error'); return; }
  if ($('#propHeading').value.trim()) props.heading = $('#propHeading').value.trim();
  if ($('#propSub').value.trim()) props.sub = $('#propSub').value.trim();
  if ($('#propLabel').value.trim()) props.label = $('#propLabel').value.trim();
  await api.put('/scenes/' + propsScene.id, { props });
  closeModal('#propsModal');
  toast('Đang tạo preview…');
  const r = await api.post(`/scenes/${propsScene.id}/preview-frame`, {});
  const sc = state.scenes.find((x) => x.id === propsScene.id);
  if (sc) {
    sc.props = props;
    if (r.image) sc.image_path = decodeURIComponent(r.image.split('path=')[1] || '');
    const card = document.querySelector(`#sceneGrid .scene[data-id="${sc.id}"]`);
    if (card) { card.dataset.img = ''; patchScene(card, sc); }
  }
  toast('Đã lưu cảnh ✓', 'success');
}

// ---------------- live scene preview ----------------
export function openLivePreview(s) {
  const ar = state.current?.aspect_ratio || '9:16';
  const dims = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] }[ar] || [1080, 1920];
  const maxH = Math.min(640, window.innerHeight * 0.72);
  const scale = Math.min(maxH / dims[1], (window.innerWidth * 0.8) / dims[0]);
  const wrap = $('#liveWrap'); wrap.innerHTML = '';
  wrap.style.width = Math.round(dims[0] * scale) + 'px';
  wrap.style.height = Math.round(dims[1] * scale) + 'px';
  const f = document.createElement('iframe');
  f.src = '/api/scenes/' + s.id + '/anim-html';
  f.style.cssText = `width:${dims[0]}px;height:${dims[1]}px;transform:scale(${scale});transform-origin:0 0;border:0;display:block`;
  wrap.appendChild(f);
  $('#liveModal').classList.add('open');
}
