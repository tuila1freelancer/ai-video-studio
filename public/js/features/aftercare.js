// What you can do with a video AFTER it is finished.
//
// Four small things, all of which were already possible and none of which were reachable:
//
//   Versions   — finalize has always written a new timestamped file and never deleted the old
//                one. Every past cut of every video was on disk, unindexed and invisible. That is
//                the difference between "I could go back" and "I dare not try anything".
//   Variants   — logo, music, watermark and transitions all live in the concat, so a second cut
//                from the same clips costs one join. The app only ever imagined one output.
//   Jump       — metadata.timeline says which scene is on screen at any moment. Finding the
//                scene behind a bad frame meant adding up durations by hand.
//   Check      — a scan for what the eye misses, above all a clip that no longer matches the
//                design in the database. It reports; it never edits.
import { $ } from '../ui/dom.js';
import { api } from '../api.js';
import { toast } from '../ui/toast.js';
import { state } from '../state.js';
import { confirmDialog, menuDialog } from '../ui/dialog.js';
import { openSceneStudio } from './scene-studio.js';

/** Scene Studio takes the row, not the id — the list the view already holds has it. */
function openSceneFromId(sceneId) {
  const row = (state.scenes || []).find((s) => s.id === sceneId);
  if (row) openSceneStudio(row);
  else toast('Không tìm thấy cảnh này trong danh sách đang mở', 'error');
}

const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const when = (ms) => new Date(ms).toLocaleString('vi-VN');

// Cuts worth having that cost nothing but a join, because every one of them is a concat setting.
const VARIANTS = [
  { name: 'Không logo', hint: 'để đối tác tự gắn nhận diện', config: { logo: null, brandKit: { finalOverlay: { enabled: false } } } },
  { name: 'Không nhạc nền', hint: 'tránh vướng bản quyền khi đăng lại', config: { bgmPath: null, autoBgm: false, soundDesign: false } },
  { name: 'Không watermark', hint: 'bản sạch để dựng tiếp', config: { watermark: null, brandKit: { watermark: { enabled: false } } } },
  { name: 'Ghép nhanh', hint: 'encode nhanh hơn ~1.8×, chất lượng gần như không đổi', config: { concatEncoder: 'fast' } },
];

export async function openVersions() {
  const id = state.current?.id;
  if (!id) return;
  let versions = [];
  try { versions = (await api.get(`/projects/${id}/versions`)).versions || []; } catch (e) {
    toast(`✖ ${e.message}`, 'error'); return;
  }
  if (!versions.length) {
    toast('Chưa có bản xuất nào được ghi lại — bản kế tiếp sẽ bắt đầu lịch sử', 'info');
    return;
  }
  const items = versions.map((v, i) => ({
    id: v.id,
    icon: v.variant ? '📦' : (i === 0 ? '●' : '🎞'),
    label: `${v.variant || 'Bản chính'} · ${when(v.created_at)} · ${fmtT(v.duration || 0)}`
      + `${v.changes?.length ? ` · đổi: ${v.changes.slice(0, 3).join(', ')}` : ''}`,
  }));
  const pick = await menuDialog({ title: 'Phiên bản đã xuất', items });
  if (!pick) return;
  const v = versions.find((x) => x.id === pick);
  if (!v) return;
  const ok = await confirmDialog({
    title: 'Quay về phiên bản này?',
    body: `Video chính sẽ trỏ lại file của bản ${when(v.created_at)} và cấu hình được khôi phục theo bản đó. `
      + 'Bản mới hơn KHÔNG bị xoá — nó vẫn nằm trong danh sách này.',
    okText: 'Quay về bản này',
  });
  if (!ok) return;
  try {
    await api.post(`/projects/${id}/versions/${v.id}/restore`, {});
    toast('↩︎ Đã quay về phiên bản đã chọn', 'success');
    location.reload();
  } catch (e) { toast(`✖ ${e.message}`, 'error'); }
}

export async function openVariant() {
  const id = state.current?.id;
  if (!id) return;
  const pick = await menuDialog({
    title: 'Xuất một bản khác từ cùng bộ clip',
    items: VARIANTS.map((v) => ({ id: v.name, icon: '📦', label: `${v.name} — ${v.hint}` })),
  });
  if (!pick) return;
  const v = VARIANTS.find((x) => x.name === pick);
  try {
    await api.post(`/projects/${id}/export-variant`, { name: v.name, config: v.config });
    toast(`📦 Đang xuất bản "${v.name}" — video chính giữ nguyên`, 'success');
  } catch (e) { toast(`✖ ${e.message}`, 'error'); }
}

const KIND_LABEL = {
  'clip-stale': '🔴 Clip không khớp thiết kế',
  'clip-missing': '🔴 Thiếu clip',
  'wrong-language': '🟠 Chữ sai ngôn ngữ',
  'number-locale': '🟡 Quy ước số/tiền tệ',
  'empty-label': '🟡 Nhãn bị xoá trắng',
  'no-design': '🟠 Cảnh chưa có thiết kế',
};

export async function openQcScan() {
  const id = state.current?.id;
  if (!id) return;
  const btn = $('#btnQcScan');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang quét…'; }
  try {
    const r = await api.get(`/projects/${id}/qc-scan`);
    if (!r.findings.length) {
      toast(`✓ Quét ${r.scenes} cảnh — không thấy vấn đề nào`, 'success');
      return;
    }
    // Grouped by kind, worst first, and every row names its scene so the report is actionable
    // rather than merely alarming.
    const order = Object.keys(KIND_LABEL);
    const rows = r.findings.slice().sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    const pick = await menuDialog({
      title: `Kiểm tra video — ${r.findings.length} điểm cần xem`,
      items: rows.slice(0, 40).map((f) => ({
        id: f.sceneId, danger: f.kind.startsWith('clip-'),
        label: `${KIND_LABEL[f.kind] || f.kind} · cảnh ${f.sceneIdx}: ${f.detail}`,
      })),
    });
    if (pick) openSceneFromId(pick);
  } catch (e) {
    toast(`✖ ${e.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔬 Kiểm tra'; }
  }
}

/**
 * Click a moment in the finished video → open the scene that produced it.
 *
 * Reads project.metadata.timeline, which the concat writes from the offsets it actually
 * assembled. Deriving it here from scene durations would be wrong by one crossfade per join,
 * and increasingly wrong the further into the video the owner clicks.
 */
export function initJumpToScene() {
  const video = $('#finalVideo');
  const hint = $('#jumpHint');
  if (!video) return;
  const timeline = () => state.current?.metadata?.timeline || [];
  const at = (t) => timeline().find((s) => t >= s.start && t < s.end);

  video.addEventListener('timeupdate', () => {
    if (!hint) return;
    const s = at(video.currentTime);
    hint.innerHTML = s
      ? `▶ Đang ở <strong>cảnh ${s.idx + 1}</strong> (${fmtT(s.start)}–${fmtT(s.end)}) — <a href="#" id="jumpGo">mở cảnh này để sửa</a>`
      : (timeline().length ? '' : 'Bản dựng này chưa lưu bản đồ thời gian — lần ghép tới sẽ có.');
  });
  if (hint) {
    hint.addEventListener('click', (e) => {
      if (e.target.id !== 'jumpGo') return;
      e.preventDefault();
      const s = at(video.currentTime);
      if (s?.sceneId) openSceneFromId(s.sceneId);
    });
  }
}

export function initAftercare() {
  $('#btnVersions')?.addEventListener('click', openVersions);
  $('#btnVariant')?.addEventListener('click', openVariant);
  $('#btnQcScan')?.addEventListener('click', openQcScan);
  initJumpToScene();
}
