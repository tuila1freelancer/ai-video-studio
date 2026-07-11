import { $, $$, el, esc, badgeText, statusIcon } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { api, fileUrl, withLock, WS } from '../api.js';
import { state } from '../state.js';
import { PIPE, PHASE_W, PHASE_ORDER, prog, resetProgress, setProgress, recomputeProgress, setStep, showOp, hideOp, appendLog } from './progress.js';
import { renderScenes, refreshScenes, onSceneUpdate, flushSceneUpdates, selectedIds, updateSelCount, regenScene, renderScenes2 } from './scenes.js';
import { icon } from '../ui/icons.js';
import { renderGallery } from './home.js';
import { switchPage } from './nav.js';
import { gatherConfig, applyConfig } from './config.js';
import { openSrt } from '../features/srt.js';
import { confirmDialog } from '../ui/dialog.js';

let ws = null;
export function initWs() { ws = new WS(onWsMessage); }

export function initStudio() {
  // SVG icon labels (markup keeps plain text for graceful no-JS degradation)
  $('#btnFetch').innerHTML = `${icon('link', 13)} Lấy thông tin`;
  $('#btnImgSearch').innerHTML = `${icon('image', 13)} Tìm ảnh AI`;
  $('#btnStart').innerHTML = `${icon('play', 15)} Bắt đầu`;
  $('#btnRender').innerHTML = `${icon('refresh', 14)} Render lại`;
  $('#btnStop').innerHTML = `${icon('stop', 14)} Dừng`;
  $('#btnResume').innerHTML = `${icon('play', 14)} Tiếp tục`;
  $('#btnSrt').innerHTML = `${icon('subtitles', 14)} SRT`;
  $('#btnMeta').innerHTML = `${icon('gauge', 14)} Metadata`;
  $('#btnRegenVoiceSel').innerHTML = `${icon('mic', 13)} Voice đã chọn`;
  $('#btnRegenHtmlSel').innerHTML = `${icon('refresh', 13)} HTML đã chọn`;
  $('#btnRenderSel').innerHTML = `${icon('film', 13)} Render đã chọn`;
  $('#btnRenderAll').innerHTML = `${icon('check', 13)} Render + Ghép`;
  $('#btnDownload').innerHTML = `${icon('download', 14)} Tải video`;
  $('#btnDownloadSrt').innerHTML = `${icon('subtitles', 14)} Tải .SRT`;
  $('#btnOpenFolder').innerHTML = `${icon('folder', 14)} Mở thư mục`;
  const lt = $('#logToggle');
  if (lt?.firstElementChild) lt.firstElementChild.innerHTML = `${icon('book', 13)} Nhật ký xử lý`;
  $('#topic').addEventListener('input', detectType);
  $('#btnStart').addEventListener('click', () => withLock($('#btnStart'), createAndStart));
  $('#btnDelAll').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Xoá tất cả dự án?', body: 'Toàn bộ dự án của kênh hiện tại sẽ bị xoá khỏi danh sách.', okText: 'Xoá tất cả', danger: true });
    if (ok) { await api.del('/projects'); startNewProject(); loadProjects(); }
  });
  $('#btnStop').addEventListener('click', () => api.post(`/projects/${state.current.id}/stop`, {}));
  $('#btnResume').addEventListener('click', () => api.post(`/projects/${state.current.id}/resume`, {}));
  $('#btnRender').addEventListener('click', () => withLock($('#btnRender'), () => renderScenes2('all')));
  $('#btnRenderAll').addEventListener('click', () => withLock($('#btnRenderAll'), () => renderScenes2('all')));
  $('#btnRenderSel').addEventListener('click', () => withLock($('#btnRenderSel'), () => renderScenes2('scenes', selectedIds())));
  $('#btnRegenVoiceSel').addEventListener('click', () => selectedIds().forEach((id) => regenScene(id, 'voice')));
  $('#btnRegenHtmlSel').addEventListener('click', () => selectedIds().forEach((id) => regenScene(id, 'html')));
  $('#checkAll').addEventListener('change', (e) => { $$('#sceneGrid .scene').forEach((c) => { c.classList.toggle('sel', e.target.checked); c.querySelector('.chk').checked = e.target.checked; }); updateSelCount(); });
  $('#btnSrt').addEventListener('click', openSrt);
  $('#btnMeta').addEventListener('click', genMeta);
  $('#logToggle').addEventListener('click', () => { const b = $('#logBody'); const open = b.style.display !== 'none'; b.style.display = open ? 'none' : 'block'; $('#logCaret').textContent = open ? '▸' : '▾'; });
  $('#btnFetch').addEventListener('click', fetchLink);
  $('#btnImgSearch').addEventListener('click', imageSearch);
  $('#assetInput').addEventListener('change', uploadAssets);
}

// ---------------- projects ----------------
export async function loadProjects() {
  const { projects } = await api.get('/projects');
  state.projects = projects;
  state.projectsLoaded = true;
  renderProjectList();
  renderGallery();
}
export function renderProjectList() {
  const box = $('#projList');
  if (!state.projects.length) { box.innerHTML = '<div class="empty">Chưa có dự án</div>'; return; }
  box.innerHTML = '';
  state.projects.forEach((p) => {
    const it = el('div', 'pitem' + (state.current && state.current.id === p.id ? ' active' : ''));
    it.innerHTML = `${p.thumb_path ? `<img class="thumb" src="${fileUrl(p.thumb_path)}" loading="lazy" decoding="async">` : '<div class="thumb"></div>'}
      <div class="meta"><div class="t">${esc(p.title)}</div><div class="s">${badgeText(p.status)} · ${p.aspect_ratio}</div></div>`;
    it.addEventListener('click', () => openProject(p.id));
    box.appendChild(it);
  });
}

export function startNewProject() {
  state.current = null; state.scenes = []; state.assets = [];
  $('#welcome').classList.remove('hidden');
  $('#projView').classList.add('hidden');
  $('#topic').value = ''; $('#assetList').innerHTML = ''; $('#imgResults').innerHTML = '';
  renderProjectList();
}

// Module-level in-flight guard: createAndStart is reachable from two buttons (#btnStart and
// the home hero) — whichever fires second must be a no-op, never a duplicate project.
let creating = false;
export async function createAndStart() {
  if (creating) return;
  const topic = $('#topic').value.trim();
  if (!topic) { toast('Nhập chủ đề trước đã.', 'error'); return; }
  creating = true;
  try {
    resetProgress();
    const config = gatherConfig();
    const { project } = await api.post('/projects', { topic, config });
    await loadProjects();
    await openProject(project.id);
    await api.post(`/projects/${project.id}/start`, { config });
    toast('Đã bắt đầu pipeline 🚀', 'success');
  } catch (e) {
    toast(`Không tạo được video: ${e.message}`, 'error');
  } finally {
    creating = false;
  }
}

export async function openProject(id) {
  switchPage('studio');
  const { project, scenes } = await api.get('/projects/' + id);
  state.current = project; state.scenes = scenes || [];
  try { localStorage.lastProjectId = id; } catch { /* private mode */ }
  ws.subscribe(id);
  applyConfig(project.config || {});
  $('#welcome').classList.add('hidden');
  $('#projView').classList.remove('hidden');
  renderProjectView();
  renderProjectList();
}

export function renderProjectView() {
  const p = state.current; if (!p) return;
  $('#pvTitle').textContent = p.title;
  $('#pvStatus').textContent = badgeText(p.status);
  $('#pvStatus').className = 'badge ' + p.status;
  $('#pvAr').textContent = p.aspect_ratio;
  $('#pvDate').textContent = new Date(p.updated_at).toLocaleString('vi-VN');
  $('#btnStop').classList.toggle('hidden', p.status !== 'running');
  $('#btnResume').classList.toggle('hidden', p.status !== 'paused' && p.status !== 'error');
  // reset pipeline visuals from scene statuses
  resetPipeFromState();
  renderScenes();
  renderFinal();
  renderMeta();
}

function resetPipeFromState() {
  PIPE.forEach((s) => setStep(s.k, 'idle'));
  const p = state.current;
  if (!p) return;
  if (state.scenes.length) { setStep('b2', 'done'); }
  if (state.scenes.some((s) => s.audio_path)) setStep('b34', 'done');
  if (state.scenes.some((s) => s.image_path)) setStep('b5', 'done');
  if (state.scenes.some((s) => s.video_path)) setStep('b6', 'done');
  if (p.video_path) setStep('b7', 'done');
}

// ---------------- final + meta ----------------
function renderFinal() {
  const p = state.current;
  const show = p && p.video_path && p.status === 'done';
  $('#finalView').classList.toggle('hidden', !show);
  if (show) {
    $('#finalVideo').src = fileUrl(p.video_path);
    $('#btnDownload').href = fileUrl(p.video_path);
    $('#btnDownloadSrt').href = '/api/projects/' + p.id + '/srt';
  }
}
export function renderMeta() {
  const box = $('#metaCard'); const m = state.current && state.current.metadata;
  if (!m) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="meta-card"><div class="mt">${esc(m.title || '')}</div><div style="color:var(--muted);white-space:pre-wrap">${esc(m.description || '')}</div>
    <div class="tags">${(m.hashtags || []).map((h) => `<span class="tag-chip">${esc(h)}</span>`).join('')}</div></div>`;
}
async function genMeta() {
  toast('Đang tạo metadata…');
  const r = await api.post('/metadata', { projectId: state.current.id, stylePrompt: '' });
  if (r.metadata) { state.current.metadata = r.metadata; renderMeta(); toast('Đã tạo metadata ✓', 'success'); }
}

// ---------------- WS ----------------
function onWsMessage(m) {
  if (m.type === '_status') { state.wsOpen = m.open; $('#wsDot').textContent = m.open ? '● realtime' : '● offline'; $('#wsDot').classList.toggle('on', m.open); return; }
  if (!state.current || (m.projectId && m.projectId !== state.current.id)) return;
  switch (m.type) {
    case 'step':
      flushSceneUpdates(); // coalesced patches must land before step transitions
      setStep(m.step, m.state, m.detail);
      if (m.state === 'running') { showOp(PIPE.find((x) => x.k === m.step)?.n || ''); prog.step = m.step; recomputeProgress(); }
      else if (m.state === 'done') {
        const i = PHASE_ORDER.indexOf(m.step);
        if (i >= 0) setProgress(PHASE_ORDER.slice(0, i + 1).reduce((s, k) => s + PHASE_W[k], 0));
        if (m.step === 'b2') { prog.total = parseInt(m.detail) || prog.total; refreshScenes(); }
      }
      break;
    case 'op': showOp(m.text); break;
    case 'log': appendLog(m); break;
    case 'status': flushSceneUpdates(); updateStatusBadge(m.status); break;
    case 'scene': onSceneUpdate(m); break;
    case 'retry': onRetryEvent(m); break;
    case 'done': flushSceneUpdates(); onDone(m); break;
    case 'error':
      flushSceneUpdates();
      toast('Lỗi: ' + m.msg, 'error'); hideOp(); updateStatusBadge('error');
      if (prog.step) setStep(prog.step, 'error', (m.msg || '').slice(0, 60));
      break;
  }
}
// Self-heal visibility: 'đang tự thử lại' — the user sees the app fixing itself, not a stall.
function onRetryEvent(m) {
  const label = m.scope === 'pipeline'
    ? `🩹 Gặp lỗi "${(m.msg || '').slice(0, 70)}" — tự động chạy tiếp sau ${Math.round((m.delayMs || 8000) / 1000)}s…`
    : `🩹 ${m.idx != null ? `Cảnh ${m.idx + 1}: ` : ''}đang tự thử lại${m.attempt ? ` (lần ${m.attempt + 1})` : ''}…`;
  showOp(label, true);
  if (m.step) setStep(m.step, 'running', '🩹 tự thử lại…');
  if (m.idx != null) {
    const sc = state.scenes.find((s) => s.idx === m.idx);
    if (sc) { sc.status = 'retrying'; const cEl = document.querySelector(`#sceneGrid .scene[data-id="${sc.id}"] .n span:last-child`); if (cEl) cEl.textContent = statusIcon('retrying'); }
  }
}
function updateStatusBadge(status) {
  if (state.current) state.current.status = status;
  $('#pvStatus').textContent = badgeText(status); $('#pvStatus').className = 'badge ' + status;
  $('#btnStop').classList.toggle('hidden', status !== 'running');
  $('#btnResume').classList.toggle('hidden', status !== 'paused' && status !== 'error');
}
async function onDone(m) {
  hideOp(); setProgress(100); toast('Video hoàn thành ✓', 'success');
  const r = await api.get('/projects/' + state.current.id);
  state.current = r.project; state.scenes = r.scenes;
  renderProjectView();
  setProgress(100);
  loadProjects();
}

// ---------------- input helpers ----------------
function detectType() {
  const v = $('#topic').value.trim();
  let t = 'văn bản';
  if (/^https?:\/\/\S+$/i.test(v.split(/\s+/)[0]) && v.split(/\s+/).length <= 3) t = 'link 🔗';
  else if ((v.startsWith('{') || v.startsWith('['))) t = 'JSON';
  $('#inputTypeHint').textContent = 'Nhận diện: ' + t;
}
async function fetchLink() {
  const url = $('#topic').value.trim().split(/\s+/)[0];
  if (!/^https?:/.test(url)) { toast('Dán 1 link http(s) trước.', 'error'); return; }
  toast('Đang lấy nội dung…');
  const r = await api.post('/fetch-link', { url });
  if (r.error) return toast(r.error, 'error');
  $('#topic').value = (r.title ? r.title + '\n' : '') + (r.text || '');
  if (r.images?.length) showImages(r.images);
  toast('Đã lấy nội dung ✓', 'success');
}
async function imageSearch() {
  const q = $('#topic').value.trim().slice(0, 120) || 'video';
  toast('Đang tìm ảnh…');
  const r = await api.post('/image-search', { query: q, count: 6 });
  if (r.images?.length) { showImages(r.images); toast(`Tìm thấy ${r.images.length} ảnh (${r.source})`, 'success'); }
}
function showImages(images) {
  const box = $('#imgResults'); box.innerHTML = '';
  images.slice(0, 8).forEach((u) => {
    const i = el('img'); i.src = u.startsWith('/api') || u.startsWith('http') ? u : fileUrl(u);
    i.style = 'width:46px;height:46px;object-fit:cover;border-radius:6px;cursor:pointer';
    i.title = 'Thêm vào assets'; i.addEventListener('click', () => { state.assets.push(u); toast('Đã thêm ảnh'); });
    box.appendChild(i);
  });
}
async function uploadAssets(e) {
  const fd = new FormData();
  [...e.target.files].forEach((f) => fd.append('files', f));
  const r = await api.upload('/upload', fd);
  (r.files || []).forEach((f) => { state.assets.push(f.path); const tag = el('span', 'badge', esc(f.name.slice(0, 14))); $('#assetList').appendChild(tag); });
  toast(`Đã thêm ${(r.files || []).length} file`, 'success');
}
