// Pre-create config sheet — the review step between "the assistant suggested it" and
// "a project exists". The sheet only emits the REQUEST layer; the server keeps layering
// app defaults → channel → default preset → this object, same as every creation path.
// Deliberately NOT the studio panel: #cfgModal's parked .cfg-body has a single owner
// and sits below #autopilotModal in the stacking order.
import { esc } from '../ui/dom.js';
import { api } from '../api.js';
import { toast } from '../ui/toast.js';
import { state } from '../state.js';
import { openDialog } from '../ui/dialog.js';
import { gatherConfig } from '../views/config.js';

function toLocalInput(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function defaultDue() {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  d.setHours(8, 0, 0, 0);
  return toLocalInput(d.getTime());
}

/** The active channel's assistant preferences (config.assistant — carries no secrets). */
export function channelAssistant() {
  const ch = (state.channels || []).find((c) => c.id === state.activeChannel);
  return ch?.config?.assistant || null;
}

function voiceOptions() {
  const favs = new Set(state.settings?.tts?.favVoices || []);
  const current = state.settings?.tts?.langVoices?.vi;
  const vi = (state.voiceCatalog || []).filter((v) => v.lang === 'vi');
  vi.sort((a, b) => (favs.has(b.provider + '/' + b.id) - favs.has(a.provider + '/' + a.id)) || a.name.localeCompare(b.name));
  const opts = vi.slice(0, 120).map((v) => {
    const key = `${v.provider}|${v.id}`;
    const fav = favs.has(v.provider + '/' + v.id) ? '★ ' : '';
    return `<option value="${esc(key)}">${fav}${esc(v.name)} · ${esc(v.provider)}</option>`;
  });
  const label = current ? `— Theo cài đặt chung (${esc(current.voice)} · ${esc(current.provider)}) —` : '— Theo cài đặt chung —';
  return `<option value="">${label}</option>` + opts.join('');
}

const SHEET_LABELS = {
  now: ['🎬 Tạo video từ gợi ý', '🎬 Tạo ngay'],
  schedule: ['🗓 Hẹn lịch sản xuất', '🗓 Hẹn lịch'],
  edit: ['⚙ Cấu hình cho slot lịch', '💾 Lưu cấu hình'],
};

/**
 * Open the sheet for one suggestion row. Resolves {config, title?, dueAt?} on confirm,
 * null on cancel. `mode`: 'now' creates immediately, 'schedule' adds a datetime field,
 * 'edit' emits config only (for updating a queued calendar slot).
 */
export function configSheet({ row, mode, due = null }) {
  const titles = mode === 'edit' ? [] : (Array.isArray(row.titles) ? row.titles.filter(Boolean) : []);
  const presets = state.presets || [];
  const canStudio = !!document.getElementById('cfgVisualMode');
  const chDefault = channelAssistant()?.defaultConfig || null;
  return openDialog(`
    <div class="dlg-title">${SHEET_LABELS[mode][0]}</div>
    <div class="dlg-body" style="margin-bottom:10px">${esc(row.topic)}</div>
    ${titles.length ? `
    <div class="field as-block">
      <label class="label">Tiêu đề video</label>
      <label class="as-radio"><input type="radio" name="asTitle" value="" checked> <span>${esc(row.topic)} <i class="hint">(chủ đề gốc)</i></span></label>
      ${titles.map((t, i) => `<label class="as-radio"><input type="radio" name="asTitle" value="${i}"> <span>${esc(t)}</span></label>`).join('')}
    </div>` : ''}
    <div class="field as-block">
      <label class="label">Nguồn cấu hình</label>
      <label class="as-radio"><input type="radio" name="asSrc" value="channel" checked> <span>⭐ Mặc định kênh (config kênh + preset mặc định)</span></label>
      <label class="as-radio${presets.length ? '' : ' disabled'}">
        <input type="radio" name="asSrc" value="preset" ${presets.length ? '' : 'disabled'}>
        <span>Preset:</span>
        <select class="input" data-a="preset" style="flex:1;min-width:0" ${presets.length ? '' : 'disabled'}>
          ${presets.map((p) => `<option value="${esc(p.id)}">${p.is_default ? '⭐ ' : ''}${esc(p.name)}</option>`).join('')}
        </select>
      </label>
      <label class="as-radio${canStudio ? '' : ' disabled'}"><input type="radio" name="asSrc" value="studio" ${canStudio ? '' : 'disabled'}> <span>📋 Panel Studio hiện tại (toàn bộ lựa chọn đang mở)</span></label>
      ${chDefault ? '<label class="as-radio"><input type="radio" name="asSrc" value="assistant"> <span>🤖 Config trợ lý của kênh (đã lưu trong ⚙ Cài đặt trợ lý)</span></label>' : ''}
    </div>
    <div class="field as-block">
      <label class="label">Ghi đè nhanh <span class="hint">(chỉ mục nào bạn đổi mới được áp)</span></label>
      <div class="as-grid">
        <label>Khung hình <select class="input" data-a="ar">
          <option value="">(giữ nguyên)</option><option>9:16</option><option>16:9</option><option>1:1</option><option>4:5</option>
        </select></label>
        <label>Thời lượng <select class="input" data-a="vd">
          <option value="">(giữ nguyên)</option><option value="30">30 giây</option><option value="60">1 phút</option>
          <option value="90">1,5 phút</option><option value="180">3 phút</option><option value="300">5 phút</option>
        </select></label>
        <label>Hình ảnh <select class="input" data-a="vm">
          <option value="">(giữ nguyên)</option><option value="hyperframe">HyperFrame ✨</option>
          <option value="animation">Animation</option><option value="image">Ảnh AI</option>
        </select></label>
        <label>Phụ đề <select class="input" data-a="sub">
          <option value="">(giữ nguyên)</option><option value="on">Bật</option><option value="off">Tắt</option>
        </select></label>
      </div>
    </div>
    <div class="field as-block">
      <label class="label">Giọng đọc video này</label>
      <select class="input" data-a="voice">${voiceOptions()}</select>
    </div>
    ${mode === 'schedule' ? `
    <div class="field as-block">
      <label class="label">Thời điểm sản xuất</label>
      <input class="input" type="datetime-local" data-a="due" value="${due ? toLocalInput(due) : defaultDue()}">
    </div>` : ''}
    <div class="hint" style="margin:4px 0 12px">Máy chủ vẫn xếp lớp: mặc định app → kênh → preset mặc định → lựa chọn ở đây.</div>
    <div class="dlg-actions">
      <button class="btn" data-a="cancel">Huỷ</button>
      <button class="btn primary" data-a="ok">${SHEET_LABELS[mode][1]}</button>
    </div>`, {
    onReady(dlg, close) {
      // picking a preset from the dropdown implies the preset source
      dlg.querySelector('[data-a=preset]')?.addEventListener('change', () => {
        const r = dlg.querySelector('input[name=asSrc][value=preset]');
        if (r && !r.disabled) r.checked = true;
      });
      dlg.querySelector('[data-a=cancel]').addEventListener('click', () => close(null));
      dlg.querySelector('[data-a=ok]').addEventListener('click', () => {
        const src = dlg.querySelector('input[name=asSrc]:checked')?.value || 'channel';
        let config = {};
        if (src === 'preset') {
          const p = (state.presets || []).find((x) => x.id === dlg.querySelector('[data-a=preset]')?.value);
          config = { ...(p?.config || {}) };
        } else if (src === 'studio') {
          config = { ...gatherConfig() };
        } else if (src === 'assistant') {
          config = { ...(channelAssistant()?.defaultConfig || {}) };
        }
        const v = (a) => dlg.querySelector(`[data-a=${a}]`)?.value || '';
        if (v('ar')) config.aspectRatio = v('ar');
        if (v('vd')) config.videoDuration = +v('vd'); config.durationMode = 'target'; // an explicit duration pick must beat an inherited 'auto'
        if (v('vm')) config.visualMode = v('vm');
        if (v('sub')) config.enableSubtitles = v('sub') === 'on';
        if (v('voice')) {
          const [provider, ...rest] = v('voice').split('|');
          config.tts = { provider, voice: rest.join('|') };
        }
        const out = { config };
        const ti = dlg.querySelector('input[name=asTitle]:checked')?.value;
        if (ti !== undefined && ti !== '') out.title = titles[+ti];
        if (mode === 'schedule') {
          const dueAt = Date.parse(v('due'));
          if (!Number.isFinite(dueAt)) { toast('Thời điểm không hợp lệ.', 'error'); return; }
          out.dueAt = dueAt;
        }
        close(out);
      });
      dlg.querySelector('[data-a=ok]').focus();
    },
  });
}

/** Edit a queued slot's config in place (assistantBrief provenance is preserved). */
export async function slotConfigSheet(slot) {
  const picked = await configSheet({ row: { topic: slot.topic }, mode: 'edit' });
  if (!picked) return false;
  const config = slot.config?.assistantBrief
    ? { ...picked.config, assistantBrief: slot.config.assistantBrief }
    : picked.config;
  try {
    const r = await api.put(`/calendar/${slot.id}`, { config });
    if (r.ok) toast('💾 Đã cập nhật cấu hình slot.', 'success');
    return !!r.ok;
  } catch (e) { toast('✗ ' + e.message, 'error'); return false; }
}

/** Reschedule a queued slot. */
export function slotTimeDialog(slot) {
  const d = new Date(slot.due_at);
  const p = (n) => String(n).padStart(2, '0');
  const cur = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  return openDialog(`
    <div class="dlg-title">🕐 Dời lịch sản xuất</div>
    <div class="dlg-body" style="margin-bottom:10px">${esc(slot.topic)}</div>
    <div class="field" style="margin-bottom:14px"><input class="input" type="datetime-local" data-a="due" value="${cur}"></div>
    <div class="dlg-actions">
      <button class="btn" data-a="cancel">Huỷ</button>
      <button class="btn primary" data-a="ok">🕐 Dời lịch</button>
    </div>`, {
    onReady(dlg, close) {
      dlg.querySelector('[data-a=cancel]').addEventListener('click', () => close(false));
      dlg.querySelector('[data-a=ok]').addEventListener('click', async () => {
        const dueAt = Date.parse(dlg.querySelector('[data-a=due]').value);
        if (!Number.isFinite(dueAt)) { toast('Thời điểm không hợp lệ.', 'error'); return; }
        try {
          const r = await api.put(`/calendar/${slot.id}`, { dueAt });
          if (r.ok) toast('🕐 Đã dời lịch.', 'success');
          close(!!r.ok);
        } catch (e) { toast('✗ ' + e.message, 'error'); close(false); }
      });
    },
  });
}

/**
 * Plan-my-week dialog: fill the coming days with the best pending suggestions.
 * Creates SLOTS only (owner confirms the whole plan here) — never starts a pipeline.
 */
export function planWeekDialog({ times = null } = {}) {
  const prefTimes = (times && times.length ? times : ['08:00']).join(', ');
  return openDialog(`
    <div class="dlg-title">📅 Lên kế hoạch tuần</div>
    <div class="dlg-body" style="margin-bottom:10px">Tự xếp các gợi ý đang chờ (điểm viral cao trước) vào lịch sản xuất.</div>
    <div class="as-grid" style="margin-bottom:12px">
      <label>Số ngày <select class="input" data-a="days">
        <option value="7">7 ngày</option><option value="3">3 ngày</option><option value="14">14 ngày</option><option value="30">30 ngày</option>
      </select></label>
      <label>Video mỗi ngày <select class="input" data-a="perDay">
        <option value="1">1</option><option value="2">2</option><option value="3">3</option>
      </select></label>
    </div>
    <div class="field as-block">
      <label class="label">Khung giờ (cách nhau bằng dấu phẩy)</label>
      <input class="input" data-a="times" value="${esc(prefTimes)}">
    </div>
    <label class="as-radio" style="margin-bottom:12px"><input type="checkbox" data-a="useStudio"> <span>📋 Áp cấu hình từ panel Studio hiện tại cho mọi slot</span></label>
    <div class="dlg-actions">
      <button class="btn" data-a="cancel">Huỷ</button>
      <button class="btn primary" data-a="ok">📅 Xếp lịch</button>
    </div>`, {
    onReady(dlg, close) {
      dlg.querySelector('[data-a=cancel]').addEventListener('click', () => close(false));
      dlg.querySelector('[data-a=ok]').addEventListener('click', async () => {
        const v = (a) => dlg.querySelector(`[data-a=${a}]`);
        const times = v('times').value.split(',').map((t) => t.trim()).filter((t) => /^\d{1,2}:\d{2}$/.test(t));
        if (!times.length) { toast('Khung giờ không hợp lệ (vd: 08:00, 19:30).', 'error'); return; }
        const config = v('useStudio').checked ? { ...gatherConfig() } : {};
        try {
          const r = await api.post('/calendar/plan', { days: +v('days').value, perDay: +v('perDay').value, times, config });
          toast(r.planned
            ? `📅 Đã xếp ${r.planned} chủ đề vào lịch${r.skipped ? ` (còn ${r.skipped} chờ đợt sau)` : ''}.`
            : 'Không có gợi ý đang chờ để xếp — tạo thêm gợi ý trước đã.', r.planned ? 'success' : 'error');
          close(!!r.planned);
        } catch (e) { toast('✗ ' + e.message, 'error'); close(false); }
      });
    },
  });
}

/** Add a fixed weekly production window (weekday + time). Template only — never auto-runs. */
export function addRecurrenceDialog() {
  const days = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  return openDialog(`
    <div class="dlg-title">⏰ Thêm khung giờ cố định</div>
    <div class="as-grid" style="margin-bottom:14px">
      <label>Thứ <select class="input" data-a="wd">${days.map((d, i) => `<option value="${i}" ${i === 1 ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
      <label>Giờ <input class="input" type="time" data-a="time" value="08:00"></label>
    </div>
    <div class="dlg-actions">
      <button class="btn" data-a="cancel">Huỷ</button>
      <button class="btn primary" data-a="ok">⏰ Thêm</button>
    </div>`, {
    onReady(dlg, close) {
      dlg.querySelector('[data-a=cancel]').addEventListener('click', () => close(false));
      dlg.querySelector('[data-a=ok]').addEventListener('click', async () => {
        try {
          await api.post('/calendar/recurrences', {
            weekday: +dlg.querySelector('[data-a=wd]').value,
            time: dlg.querySelector('[data-a=time]').value,
          });
          toast('⏰ Đã thêm khung giờ cố định.', 'success');
          close(true);
        } catch (e) { toast('✗ ' + e.message, 'error'); close(false); }
      });
    },
  });
}

/**
 * Full owner flow for a pending suggestion: sheet → API call → toast.
 * Returns true when something was created/changed (callers refresh their views).
 */
export async function runSuggestionAction(row, act, { due = null } = {}) {
  if (act === 'dismiss') {
    const r = await api.post(`/topics/${row.id}/dismiss`);
    if (r.ok) toast('Đã bỏ qua gợi ý — có thể khôi phục trong Lịch sử.', 'success');
    return !!r.ok;
  }
  if (act === 'restore') {
    const r = await api.post(`/topics/${row.id}/restore`);
    if (r.ok) toast('↩ Đã đưa gợi ý về trạng thái chờ.', 'success');
    return !!r.ok;
  }
  const mode = act === 'now' ? 'now' : 'schedule';
  const picked = await configSheet({ row, mode, due });
  if (!picked) return false;
  try {
    if (mode === 'now') {
      await api.post(`/topics/${row.id}/accept`, { config: picked.config, title: picked.title || null });
      toast('Đã đưa vào hàng đợi sản xuất 🎬', 'success');
    } else {
      await api.post(`/topics/${row.id}/schedule`, { dueAt: picked.dueAt, config: picked.config, title: picked.title || null });
      toast('Đã hẹn lịch 🗓', 'success');
    }
    return true;
  } catch (e) { toast('✗ ' + e.message, 'error'); return false; }
}
