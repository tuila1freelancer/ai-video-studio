// Opening and drawing a project: new/create/open, the typeset button, the pipeline view, the scene gate.
import { $, badgeText } from '../../ui/dom.js';
import { toast } from '../../ui/toast.js';
import { api } from '../../api.js';
import { state, channelDefaults } from '../../state.js';
import { PIPE, resetProgress, setStep } from '../progress.js';
import { loadJournal, clearJournal } from '../../features/journal.js';
import { renderScenes } from '../scenes.js';
import { icon } from '../../ui/icons.js';
import { switchPage } from '../nav.js';
import { gatherConfig, applyConfig } from '../config.js';
import { resetPendingCheck } from '../../features/pending-changes.js';
import { confirmDialog } from '../../ui/dialog.js';
import { m, tp } from '../../i18n.js';
import { subscribeWs } from './ws.js';
import { loadProjects, renderProjectList } from './projects.js';
import { renderFinal, renderPublishHistory, renderMeta } from './outputs.js';
import { setSourceDoc } from './source.js';
import { fmtDate, fmtNum } from '../../ui/format.js';

export function startNewProject() {
  state.current = null; state.scenes = []; state.assets = [];
  $('#welcome').classList.remove('hidden');
  $('#projView').classList.add('hidden');
  $('#topic').value = ''; $('#assetList').innerHTML = ''; $('#imgResults').innerHTML = '';
  setSourceDoc(null);
  // Back to the CHANNEL's defaults, not to whatever the last project happened to use. Opening a
  // project calls applyConfig with that project's config; without this, "video mới" inherited it
  // silently — so a one-off experiment on one video became the starting point for the next.
  applyConfig(channelDefaults());
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
    // Carry the article the owner actually looked at (and may have edited). Without it the stage
    // re-fetches the URL and writes from whatever the site serves at that second instead.
    if (state.sourceDoc?.text?.trim()) {
      const d = state.sourceDoc;
      config.sourceDoc = { url: d.url || topic, title: d.title || '', text: d.text.trim() };
    }
    const { project } = await api.post('/projects', { topic, config });
    await loadProjects();
    await openProject(project.id);
    await api.post(`/projects/${project.id}/start`, { config });
    toast('Đã bắt đầu pipeline 🚀', 'success');
  } catch (e) {
    toast(tp`Không tạo được video: ${e.message}`, 'error');
  } finally {
    creating = false;
  }
}

export async function openProject(id) {
  switchPage('studio');
  const { project, scenes } = await api.get('/projects/' + id);
  state.current = project; state.scenes = scenes || [];
  try { localStorage.lastProjectId = id; } catch { /* private mode */ }
  subscribeWs(id);
  clearJournal();          // never bleed the previous project's lines
  loadJournal(id);         // full persisted history (REST) — fire-and-forget
  applyConfig(project.config || {});
  // …including the article this video was written from, so reopening it shows the material rather
  // than leaving the owner to guess which link it came from.
  setSourceDoc(project.config?.sourceDoc || null);
  // A different project has a different idea of what is pending — the previous answer describes
  // somebody else's video and must not survive the switch.
  resetPendingCheck();
  $('#welcome').classList.add('hidden');
  $('#projView').classList.remove('hidden');
  renderProjectView();
  renderProjectList();
}

/**
 * The Vietnamese repair button appears only when there is something to repair.
 *
 * The scan reads the code already stored on each scene, so it costs no render and cannot be wrong
 * about a video it has not looked at — and it names the SCENES, which is why the button can
 * promise a number instead of "re-render everything and see".
 */
async function syncTypesetButton(p) {
  const btn = $('#btnTypeset');
  btn.classList.add('hidden');
  if (!['done', 'paused', 'review'].includes(p.status)) return;
  try {
    const r = await api.get(`/projects/${p.id}/typeset-scan`);
    if (state.current?.id !== p.id || !r?.atRisk) return; // the owner may have moved on
    btn.innerHTML = `${icon('subtitles', 14)} ${tp`Sửa lỗi tiếng Việt (${r.atRisk} cảnh)`}`;
    btn.classList.remove('hidden');
  } catch { /* a scan that cannot run must not break the panel */ }
}

export async function repairTypeset() {
  const p = state.current; if (!p) return;
  const r = await api.get(`/projects/${p.id}/typeset-scan`);
  if (!r?.atRisk) { toast('Không có cảnh nào cần sửa.', 'success'); return; }
  const ok = await confirmDialog({
    title: 'Sửa lỗi chữ tiếng Việt',
    body: tp`${r.atRisk}/${r.scenes} cảnh được dựng trước khi có bản vá — dấu bị cắt hoặc hai dòng đè nhau.` + '\n\n'
      + m('Sẽ DỰNG LẠI đúng những cảnh đó rồi GHÉP LẠI video (ghi đè file hiện tại).') + '\n'
      + m('Không gọi AI, không đổi thiết kế — chỉ chữa phần chữ.'),
    okText: 'Dựng lại',
  });
  if (!ok) return;
  const res = await api.post(`/projects/${p.id}/repair-typeset`, {});
  if (res?.error) { toast(res.error, 'error'); return; }
  toast(tp`🔤 Đang dựng lại ${res.atRisk} cảnh rồi ghép`, 'success');
  $('#btnTypeset').classList.add('hidden');
}

export function renderProjectView() {
  const p = state.current; if (!p) return;
  $('#pvTitle').textContent = p.title;
  $('#pvStatus').textContent = badgeText(p.status);
  $('#pvStatus').className = 'badge ' + p.status;
  $('#pvAr').textContent = p.aspect_ratio;
  $('#pvDate').textContent = fmtDate(p.updated_at);
  $('#btnStop').classList.toggle('hidden', p.status !== 'running');
  // 'done' included: a finished video is a VERSION, not a terminal state. The fingerprint-aware
  // resume is the fastest correct path for a mixed edit and it was simply unreachable here.
  $('#btnResume').classList.toggle('hidden', !['paused', 'error', 'review', 'done'].includes(p.status));
  $('#btnResume').innerHTML = p.status === 'done'
    ? `${icon('refresh', 14)} ${m('Áp dụng thay đổi')}`
    : `${icon('play', 14)} ${m('Tiếp tục')}`;
  renderSceneGate(p);
  syncTypesetButton(p);
  // reset pipeline visuals from scene statuses
  resetPipeFromState();
  renderScenes();
  renderFinal();
  renderMeta();
  import('../thumbnail.js').then((m) => m.renderThumbPanel());
  renderPublishHistory();
}

function resetPipeFromState() {
  PIPE.forEach((s) => setStep(s.k, 'idle'));
  const p = state.current;
  if (!p) return;
  if (state.scenes.length) { setStep('b2', 'done'); }
  // scenes-first order: template/props (visuals) can exist before any audio does.
  // every(): B2 two-stage pre-assigns plans to SOME scenes (chapter breaks) — b5 is only
  // done once the whole storyboard carries one.
  if (state.scenes.length && state.scenes.every((s) => s.image_path || (s.template && s.props))) setStep('b5', 'done');
  if (state.scenes.some((s) => s.audio_path)) setStep('b34', 'done');
  if (state.scenes.some((s) => s.video_path)) setStep('b6', 'done');
  if (p.video_path) setStep('b7', 'done');
}

// Scene-gate banner: visible only while the run holds at status 'scenes'. State-derived
// (not event-derived) so WS replays and reloads render it idempotently.
export async function renderSceneGate(p) {
  const bar = $('#sceneGateBar');
  if (!bar) return;
  const show = p && p.status === 'scenes';
  bar.classList.toggle('hidden', !show);
  if (!show) return;
  const sheetBtn = $('#btnContactSheet');
  if (sheetBtn) {
    sheetBtn.onclick = () => window.open(`/api/projects/${p.id}/contact-sheet`, '_blank');
  }
  try {
    const est = await api.get(`/projects/${p.id}/voice-estimate`);
    const cost = est.credits != null ? tp`≈ ${fmtNum(est.credits)} credits LarVoice`
      : est.usd ? `≈ $${est.usd.toFixed(3)} (${est.provider})` : tp`${est.provider} (miễn phí)`;
    $('#sceneGateCost').textContent = tp`Lồng tiếng ${est.scenes} cảnh · ${fmtNum(est.chars)} ký tự · ${cost}`;
  } catch { $('#sceneGateCost').textContent = ''; }
}
