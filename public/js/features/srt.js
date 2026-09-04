// Subtitle studio: per-scene script editing (as before) PLUS a per-cue timing editor
// (start/end/text), a resync-to-script action (re-times captions on the existing audio —
// no re-synthesis), and a voice-take history picker. Cue edits are validated server-side
// (P11) and mark only the scene's CLIP stale (B6-only re-render, no TTS).
import { $, $$, el, esc } from '../ui/dom.js';
import { closeModal } from '../ui/modals.js';
import { toast } from '../ui/toast.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { renderScenes } from '../views/scenes.js';
import { m, tp } from '../i18n.js';

export function initSrt() {
  $('#srtSave').addEventListener('click', saveSrt);
}

export function openSrt() {
  if (!state.scenes.length) { toast('Chưa có cảnh nào.', 'error'); return; }
  const box = $('#srtList'); box.innerHTML = '';
  state.scenes.forEach((s) => {
    const d = el('div', 'field srt-scene');
    const cueCount = Array.isArray(s.srt_json) ? s.srt_json.length : 0;
    d.innerHTML = `
      <label class="label">${tp`Cảnh ${s.idx + 1}`} · ${(s.duration || 0).toFixed(1)}s</label>
      <textarea class="input" rows="2" data-sid="${s.id}">${esc(s.voice_text || '')}</textarea>
      <div class="row srt-tools" data-sid="${s.id}" style="gap:6px;margin-top:4px;flex-wrap:wrap">
        ${cueCount ? `<button class="btn sm" data-act="cues">${tp`⏱ Phụ đề (${cueCount} dòng)`}</button>
        <button class="btn sm" data-act="resync" title="${esc(m('Chia lại phụ đề theo kịch bản trên audio hiện có — không thu âm lại'))}">${m('↻ Đồng bộ lại')}</button>` : ''}
        <button class="btn sm" data-act="takes" title="${esc(m('Các bản thu giọng trước đây của cảnh này'))}">${m('🕘 Bản thu')}</button>
      </div>
      <div class="srt-cues hidden" data-sid="${s.id}"></div>
      <div class="srt-takes hidden" data-sid="${s.id}"></div>`;
    box.appendChild(d);
  });
  box.querySelectorAll('.srt-tools').forEach((bar) => bar.addEventListener('click', (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    const sid = bar.dataset.sid;
    if (btn.dataset.act === 'cues') toggleCues(sid);
    else if (btn.dataset.act === 'resync') resync(sid, btn);
    else if (btn.dataset.act === 'takes') toggleTakes(sid);
  }));
  $('#srtModal').classList.add('open');
}

function sceneById(sid) { return state.scenes.find((s) => s.id === sid); }

function toggleCues(sid) {
  const wrap = document.querySelector(`.srt-cues[data-sid="${sid}"]`);
  if (!wrap.classList.contains('hidden')) { wrap.classList.add('hidden'); return; }
  const s = sceneById(sid);
  const cues = Array.isArray(s?.srt_json) ? s.srt_json : [];
  wrap.innerHTML = cues.map((c, i) => `
    <div class="srt-cue" data-i="${i}">
      <input class="input sm num" type="number" step="0.05" min="0" value="${(+c.start).toFixed(2)}" data-f="start" title="${esc(m('bắt đầu (s)'))}">
      <input class="input sm num" type="number" step="0.05" min="0" value="${(+c.end).toFixed(2)}" data-f="end" title="${esc(m('kết thúc (s)'))}">
      <input class="input sm txt" value="${esc(c.text)}" data-f="text">
    </div>`).join('') || `<div class="hint">${m('Chưa có phụ đề — chạy TTS trước.')}</div>`;
  wrap.classList.remove('hidden');
}

// Collect cue edits for one scene: rebuilt words redistribute evenly (length-weighted)
// inside the cue window when the text changed — karaoke stays smooth.
function collectCues(sid) {
  const wrap = document.querySelector(`.srt-cues[data-sid="${sid}"]`);
  if (!wrap || wrap.classList.contains('hidden')) return null;
  const s = sceneById(sid);
  const orig = Array.isArray(s?.srt_json) ? s.srt_json : [];
  const rows = [...wrap.querySelectorAll('.srt-cue')];
  if (!rows.length) return null;
  let changed = false;
  const cues = rows.map((row, i) => {
    const start = Math.max(0, parseFloat(row.querySelector('[data-f=start]').value) || 0);
    const end = Math.max(start + 0.1, parseFloat(row.querySelector('[data-f=end]').value) || start + 0.1);
    const text = row.querySelector('[data-f=text]').value.trim();
    const o = orig[i] || {};
    if (Math.abs(start - o.start) > 0.001 || Math.abs(end - o.end) > 0.001 || text !== o.text) changed = true;
    let words = o.words || [];
    if (text !== o.text || !words.length) {
      const toks = text.split(/\s+/).filter(Boolean);
      const weights = toks.map((w) => Math.max(2, w.length));
      const totalW = weights.reduce((a, b) => a + b, 0) || 1;
      let t = start;
      words = toks.map((w, j) => { const d = ((end - start) * weights[j]) / totalW; const ww = { start: +t.toFixed(3), end: +(t + d).toFixed(3), word: w }; t += d; return ww; });
    } else if (Math.abs(start - o.start) > 0.001 || Math.abs(end - o.end) > 0.001) {
      // window moved, text same → shift+scale existing word times into the new window
      const k = (end - start) / Math.max(0.1, o.end - o.start);
      words = words.map((w) => ({ ...w, start: +(start + (w.start - o.start) * k).toFixed(3), end: +(start + (w.end - o.start) * k).toFixed(3) }));
    }
    return { start: +start.toFixed(3), end: +end.toFixed(3), text, words };
  });
  return changed ? cues : null;
}

async function resync(sid, btn) {
  btn.disabled = true; btn.textContent = '⏳…';
  try {
    const { scene } = await api.post(`/scenes/${sid}/resync-subs`, {});
    const i = state.scenes.findIndex((s) => s.id === sid);
    if (i >= 0) state.scenes[i] = scene;
    document.querySelector(`.srt-cues[data-sid="${sid}"]`)?.classList.add('hidden');
    toast('Đã đồng bộ lại phụ đề theo kịch bản ↻', 'success');
  } catch (e) { toast(tp`Lỗi đồng bộ: ${e.message}`, 'error'); }
  btn.disabled = false; btn.textContent = m('↻ Đồng bộ lại');
}

async function toggleTakes(sid) {
  const wrap = document.querySelector(`.srt-takes[data-sid="${sid}"]`);
  if (!wrap.classList.contains('hidden')) { wrap.classList.add('hidden'); return; }
  wrap.innerHTML = `<div class="hint">${m('⏳ Đang tải…')}</div>`;
  wrap.classList.remove('hidden');
  try {
    const { takes } = await api.get(`/scenes/${sid}/takes?kind=voice`);
    if (!takes.length) { wrap.innerHTML = `<div class="hint">${m('Chưa có bản thu nào khác (tạo bằng “Voice đã chọn”).')}</div>`; return; }
    wrap.innerHTML = takes.map((t) => `
      <div class="row" style="gap:8px;align-items:center;margin-top:4px">
        <span class="hint" style="flex:1">${t.is_active ? m('● đang dùng') + ' · ' : ''}${new Date(t.created_at).toLocaleTimeString('vi-VN')} · ${(t.payload.duration || 0).toFixed(1)}s</span>
        ${t.payload.audio_path ? `<audio controls preload="none" src="/api/file?path=${encodeURIComponent(t.payload.audio_path)}" style="height:26px"></audio>` : ''}
        ${t.is_active ? '' : `<button class="btn sm" data-take="${t.id}">${m('Dùng bản này')}</button>`}
      </div>`).join('');
    wrap.querySelectorAll('[data-take]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const { scene } = await api.post(`/takes/${b.dataset.take}/activate`, {});
        const i = state.scenes.findIndex((s) => s.id === sid);
        if (i >= 0) state.scenes[i] = scene;
        toast('Đã chuyển sang bản thu này — render lại để áp dụng.', 'success');
        wrap.classList.add('hidden');
      } catch (e) { toast(tp`Lỗi: ${e.message}`, 'error'); }
    }));
  } catch (e) { wrap.innerHTML = `<div class="hint">✗ ${esc(e.message)}</div>`; }
}

async function saveSrt() {
  for (const ta of $$('#srtList textarea')) {
    const sid = ta.dataset.sid;
    const s = sceneById(sid);
    const body = {};
    if ((s?.voice_text || '') !== ta.value) body.voice_text = ta.value;
    const cues = collectCues(sid);
    if (cues && !body.voice_text) body.srt_json = cues; // a voice edit already invalidates cues
    if (Object.keys(body).length) await api.put('/scenes/' + sid, body);
  }
  const r = await api.get('/projects/' + state.current.id); state.scenes = r.scenes; renderScenes();
  closeModal('#srtModal');
  toast('Đã lưu. Cảnh sửa lời cần “Voice đã chọn”; cảnh sửa phụ đề chỉ cần Render.', 'success');
}
