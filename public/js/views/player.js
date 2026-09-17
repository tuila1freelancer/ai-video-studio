// Rough-cut player — preview the WHOLE video before spending any render time.
// One master rAF clock drives a moving window of live scene iframes (each is the existing
// /api/scenes/:id/anim-html paused-timeline page, live=0) via contentWindow.__seek(localT),
// plus the scene's narration audio (served through the /api/file allowlist, P15).
// Read-only by design; a live GSAP page is not pixel-identical to the ffmpeg render —
// the header labels it as a PREVIEW.
import { $, el } from '../ui/dom.js';
import { state } from '../state.js';
import { api, fileUrl } from '../api.js';
import { toast } from '../ui/toast.js';
import { m, tp } from '../i18n.js';

let scenes = [], starts = [], total = 0;
let t = 0, playing = false, raf = 0, lastTs = 0, activeIdx = -1;
const frames = new Map(); // idx -> { iframe, ready, audio }
let sceneSize = { w: 1080, h: 1920 };
let reviews = new Map(); // sceneId -> 'approved'|'rejected'
const peaks = new Map(); // idx -> number[] (waveform buckets, lazy-loaded around playhead)
const peaksLoading = new Set();

const dur = (i) => Math.max(1.5, scenes[i]?.duration || 6);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

let wired = false;
export function initPlayer() {
  if (wired) return;
  wired = true;
  $('#btnRoughCut')?.addEventListener('click', openPlayer);
  $('#rcClose')?.addEventListener('click', closePlayer);
  $('#rcPlay')?.addEventListener('click', toggle);
  $('#rcSeek')?.addEventListener('input', (e) => seekTo(parseFloat(e.target.value)));
  $('#rcApprove')?.addEventListener('click', () => reviewActive('approved'));
  $('#rcReject')?.addEventListener('click', () => reviewActive('rejected'));
  $('#rcFs')?.addEventListener('click', toggleFullscreen);
  document.addEventListener('keydown', (e) => {
    const ov = $('#rcOverlay');
    if (!ov || ov.classList.contains('hidden')) return;
    if (e.key === ' ') { e.preventDefault(); toggle(); }
    else if (e.key === 'Escape') closePlayer();
    else if (e.key === 'ArrowRight') seekTo(t + 5);
    else if (e.key === 'ArrowLeft') seekTo(t - 5);
    else if (e.key.toLowerCase() === 'f') toggleFullscreen();
  });
  window.addEventListener('resize', fitStage);
  document.addEventListener('fullscreenchange', fitStage); // re-fit the stage entering/leaving fullscreen
  // timeline lane: click/drag = scrub (read-only — reorder needs immutable-id path keying)
  const tl = $('#rcTl');
  if (tl) {
    const toTime = (e) => { const r = tl.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * total; };
    let scrubbing = false;
    tl.addEventListener('pointerdown', (e) => { scrubbing = true; tl.setPointerCapture(e.pointerId); seekTo(toTime(e)); });
    tl.addEventListener('pointermove', (e) => { if (scrubbing) seekTo(toTime(e)); });
    tl.addEventListener('pointerup', () => { scrubbing = false; });
  }
}

// lazy-load waveform peaks for scenes near the playhead
function loadPeaksAround(idx) {
  for (const i of [idx - 1, idx, idx + 1, idx + 2]) {
    const sc = scenes[i];
    if (!sc || peaks.has(i) || peaksLoading.has(i) || !sc.audio_path) continue;
    peaksLoading.add(i);
    api.get(`/scenes/${sc.id}/waveform?buckets=160`)
      .then((r) => peaks.set(i, r.peaks || []))
      .catch(() => peaks.set(i, []))
      .finally(() => peaksLoading.delete(i));
  }
}

// one canvas, three lanes: scene clips (top), waveform (middle), caption cues (bottom strip)
function drawTimeline() {
  const cv = $('#rcTl'); if (!cv) return;
  const W = cv.clientWidth, H = cv.height;
  if (cv.width !== W * devicePixelRatio) cv.width = W * devicePixelRatio;
  const g = cv.getContext('2d');
  g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  g.clearRect(0, 0, W, H);
  if (!total) return;
  const x = (time) => (time / total) * W;
  for (let i = 0; i < scenes.length; i++) {
    const x0 = x(starts[i]), x1 = x(starts[i] + dur(i));
    // clip lane
    g.fillStyle = i === activeIdx ? 'rgba(34,211,238,.22)' : i % 2 ? 'rgba(120,160,255,.10)' : 'rgba(120,160,255,.06)';
    g.fillRect(x0 + 0.5, 4, Math.max(1, x1 - x0 - 1), 30);
    const rv = reviews.get(scenes[i].id);
    if (rv) { g.fillStyle = rv === 'approved' ? 'rgba(52,211,153,.9)' : 'rgba(255,77,94,.9)'; g.fillRect(x0 + 0.5, 4, Math.max(1, x1 - x0 - 1), 3); }
    if (x1 - x0 > 26) {
      g.fillStyle = 'rgba(234,242,255,.75)'; g.font = '10px ui-monospace,monospace';
      g.fillText(String(i + 1), x0 + 4, 17);
    }
    // waveform lane
    const pk = peaks.get(i);
    if (pk?.length) {
      g.fillStyle = i === activeIdx ? 'rgba(34,211,238,.75)' : 'rgba(139,147,176,.55)';
      const bw = (x1 - x0) / pk.length;
      for (let b = 0; b < pk.length; b++) {
        const h = Math.max(1, pk[b] * 26);
        g.fillRect(x0 + b * bw, 52 + (26 - h) / 2, Math.max(0.5, bw - 0.4), h);
      }
    }
    // caption cue ticks
    for (const c of scenes[i].srt_json || []) {
      g.fillStyle = 'rgba(251,191,36,.5)';
      g.fillRect(x(starts[i] + c.start), H - 5, Math.max(1, x(starts[i] + c.end) - x(starts[i] + c.start) - 0.5), 3);
    }
  }
  // playhead
  g.fillStyle = '#FF2E88';
  g.fillRect(x(t) - 0.75, 0, 1.5, H);
}

async function reviewActive(status) {
  const sc = scenes[activeIdx];
  if (!sc) return;
  try {
    await api.post(`/scenes/${sc.id}/review`, { status });
    reviews.set(sc.id, status);
    renderReviewState();
    toast(status === 'approved' ? tp`✓ Đã duyệt cảnh ${activeIdx + 1}` : tp`✕ Đã loại cảnh ${activeIdx + 1} — hãy tạo lại rồi duyệt lại`, status === 'approved' ? 'success' : 'error');
  } catch (e) { toast(tp`Lỗi lưu duyệt: ${e.message}`, 'error'); }
}

function renderReviewState() {
  const sc = scenes[activeIdx];
  const st = sc ? reviews.get(sc.id) : null;
  const elx = $('#rcReviewState');
  if (elx) elx.textContent = st === 'approved' ? m('✓ đã duyệt') : st === 'rejected' ? m('✕ đã loại') : m('· chưa duyệt');
  const done = scenes.filter((s) => reviews.get(s.id) === 'approved').length;
  const lbl = $('#rcSceneLabel');
  if (lbl) lbl.textContent = tp`Cảnh ${activeIdx + 1}/${scenes.length} · đã duyệt ${done}/${scenes.length}`;
}

function openPlayer() {
  scenes = (state.scenes || []).filter((s) => s.voice_text != null);
  if (!scenes.length) { toast('Chưa có cảnh nào để xem nháp.', 'error'); return; }
  reviews = new Map();
  if (state.current) {
    api.get(`/projects/${state.current.id}/reviews`)
      .then((r) => { for (const rv of r.reviews || []) reviews.set(rv.scene_id, rv.status); renderReviewState(); })
      .catch(() => {});
  }
  starts = []; total = 0;
  for (let i = 0; i < scenes.length; i++) { starts.push(total); total += dur(i); }
  const ar = state.current?.aspect_ratio || '9:16';
  sceneSize = ar === '16:9' ? { w: 1920, h: 1080 } : ar === '1:1' ? { w: 1080, h: 1080 } : ar === '4:5' ? { w: 1080, h: 1350 } : { w: 1080, h: 1920 };
  t = 0; activeIdx = -1; playing = false;
  $('#rcSeek').max = total.toFixed(2);
  $('#rcOverlay').classList.remove('hidden');
  fitStage();
  lastTs = performance.now();
  raf = requestAnimationFrame(tick);
  render();
}

function closePlayer() {
  cancelAnimationFrame(raf);
  playing = false;
  for (const [, f] of frames) { f.audio?.pause(); f.iframe.remove(); }
  frames.clear();
  $('#rcStage').innerHTML = '';
  $('#rcOverlay').classList.add('hidden');
}

function toggle() {
  playing = !playing;
  $('#rcPlay').textContent = playing ? '⏸' : '▶';
  if (!playing) frames.get(activeIdx)?.audio?.pause();
  lastTs = performance.now();
}

function seekTo(nt) {
  t = Math.max(0, Math.min(total, nt));
  const f = frames.get(activeIdx);
  if (f?.audio) f.audio.currentTime = Math.max(0, t - starts[activeIdx]);
  render();
}

function sceneAt(time) {
  for (let i = scenes.length - 1; i >= 0; i--) if (time >= starts[i]) return i;
  return 0;
}

function toggleFullscreen() {
  const ov = $('#rcOverlay'); if (!ov || ov.classList.contains('hidden')) return;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else ov.requestFullscreen?.();
}

function fitStage() {
  const stage = $('#rcStage'); if (!stage) return;
  const wrap = stage.parentElement;
  const scale = Math.min(wrap.clientWidth / sceneSize.w, wrap.clientHeight / sceneSize.h) * 0.98;
  stage.style.width = `${sceneSize.w}px`; stage.style.height = `${sceneSize.h}px`;
  stage.style.transform = `scale(${scale})`;
}

function mount(i) {
  const sc = scenes[i];
  const iframe = el('iframe', 'rc-frame');
  iframe.width = sceneSize.w; iframe.height = sceneSize.h;
  iframe.src = `/api/scenes/${sc.id}/anim-html?live=0`;
  const f = { iframe, ready: false, audio: sc.audio_path ? new Audio(fileUrl(sc.audio_path)) : null };
  iframe.addEventListener('load', async () => {
    try { await iframe.contentWindow.__init?.(); f.ready = true; } catch { /* stays unready */ }
  });
  $('#rcStage').appendChild(iframe);
  frames.set(i, f);
}

// keep a ±1 window of mounted iframes so 200-scene projects never hold 200 pages
function ensureWindow() {
  const want = new Set([activeIdx - 1, activeIdx, activeIdx + 1].filter((i) => i >= 0 && i < scenes.length));
  for (const [i, f] of frames) if (!want.has(i)) { f.audio?.pause(); f.iframe.remove(); frames.delete(i); }
  for (const i of want) if (!frames.has(i)) mount(i);
}

function tick(ts) {
  if (playing) {
    t += (ts - lastTs) / 1000;
    if (t >= total) { t = total; playing = false; $('#rcPlay').textContent = '▶'; frames.get(activeIdx)?.audio?.pause(); }
  }
  lastTs = ts;
  render();
  raf = requestAnimationFrame(tick);
}

function render() {
  const idx = sceneAt(t);
  if (idx !== activeIdx) {
    frames.get(activeIdx)?.audio?.pause();
    activeIdx = idx;
    ensureWindow();
    loadPeaksAround(idx);
    for (const [i, f] of frames) f.iframe.classList.toggle('on', i === activeIdx);
  }
  const f = frames.get(activeIdx);
  const localT = Math.min(t - starts[activeIdx], dur(activeIdx) - 0.01);
  if (f?.ready) { try { f.iframe.contentWindow.__seek(Math.max(0, localT)); } catch { /* frame reloading */ } }
  if (f?.audio) {
    if (playing && f.audio.paused) { f.audio.currentTime = Math.max(0, localT); f.audio.play().catch(() => {}); }
    else if (playing && Math.abs(f.audio.currentTime - localT) > 0.35) f.audio.currentTime = localT; // drift snap
    else if (!playing && !f.audio.paused) f.audio.pause();
  }
  $('#rcSeek').value = t.toFixed(2);
  $('#rcTime').textContent = `${fmt(t)} / ${fmt(total)}`;
  renderReviewState();
  drawTimeline();
}
