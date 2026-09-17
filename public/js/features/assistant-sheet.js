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
import { closeModal } from '../ui/modals.js';
import { openProject } from '../views/studio.js';
import { m, tp } from '../i18n.js';
import { fmtNum } from '../ui/format.js';

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

/** The channel's script language ('vi' fallback) — voices and suggestions follow it (P34). */
function channelLang() {
  const ch = (state.channels || []).find((c) => c.id === state.activeChannel);
  const l = ch?.config?.language;
  return l && l !== 'auto' ? l : 'vi';
}

function voiceOptions() {
  const lang = channelLang();
  const favs = new Set(state.settings?.tts?.favVoices || []);
  const current = state.settings?.tts?.langVoices?.[lang] || state.settings?.tts?.langVoices?.vi;
  let vi = (state.voiceCatalog || []).filter((v) => v.lang === lang);
  if (!vi.length) vi = (state.voiceCatalog || []).filter((v) => v.lang === 'vi'); // catalog gap → vi fallback
  vi.sort((a, b) => (favs.has(b.provider + '/' + b.id) - favs.has(a.provider + '/' + a.id)) || a.name.localeCompare(b.name));
  const opts = vi.slice(0, 120).map((v) => {
    const key = `${v.provider}|${v.id}`;
    const fav = favs.has(v.provider + '/' + v.id) ? '★ ' : '';
    return `<option value="${esc(key)}">${fav}${esc(v.name)} · ${esc(v.provider)}</option>`;
  });
  const label = current ? tp`— Theo cài đặt chung (${esc(current.voice)} · ${esc(current.provider)}) —` : m('— Theo cài đặt chung —');
  return `<option value="">${label}</option>` + opts.join('');
}

// Built per call, never at module load: the catalogue arrives after these modules are imported.
const sheetLabels = (mode) => ({
  now: [m('🎬 Tạo video từ gợi ý'), m('🎬 Tạo ngay')],
  schedule: [m('🗓 Hẹn lịch sản xuất'), m('🗓 Hẹn lịch')],
  edit: [m('⚙ Cấu hình cho slot lịch'), m('💾 Lưu cấu hình')],
}[mode]);

/**
 * Open the sheet for one suggestion row. Resolves {config, title?, dueAt?} on confirm,
 * null on cancel. `mode`: 'now' creates immediately, 'schedule' adds a datetime field,
 * 'edit' emits config only (for updating a queued calendar slot).
 */
export function configSheet({ row, mode, due = null }) {
  const titles = mode === 'edit' ? [] : (Array.isArray(row.titles) ? row.titles.filter(Boolean) : []);
  const presets = state.presets || [];
  const canStudio = !!document.getElementById('cfgHfDensity');
  const chDefault = channelAssistant()?.defaultConfig || null;
  const labels = sheetLabels(mode);
  return openDialog(`
    <div class="dlg-title">${labels[0]}</div>
    <div class="dlg-body" style="margin-bottom:10px">${esc(row.topic)}</div>
    ${titles.length ? `
    <div class="field as-block">
      <label class="label">${m('Tiêu đề video')}</label>
      <label class="as-radio"><input type="radio" name="asTitle" value="" checked> <span>${esc(row.topic)} <i class="hint">${m('(chủ đề gốc)')}</i></span></label>
      ${titles.map((t, i) => `<label class="as-radio"><input type="radio" name="asTitle" value="${i}"> <span>${esc(t)}</span></label>`).join('')}
    </div>` : ''}
    <div class="field as-block">
      <label class="label">${m('Nguồn cấu hình')}</label>
      <label class="as-radio"><input type="radio" name="asSrc" value="channel" checked> <span>${m('⭐ Mặc định kênh (config kênh + preset mặc định)')}</span></label>
      <label class="as-radio${presets.length ? '' : ' disabled'}">
        <input type="radio" name="asSrc" value="preset" ${presets.length ? '' : 'disabled'}>
        <span>${m('Preset:')}</span>
        <select class="input" data-a="preset" style="flex:1;min-width:0" ${presets.length ? '' : 'disabled'}>
          ${presets.map((p) => `<option value="${esc(p.id)}">${p.is_default ? '⭐ ' : ''}${esc(p.name)}</option>`).join('')}
        </select>
      </label>
      <label class="as-radio${canStudio ? '' : ' disabled'}"><input type="radio" name="asSrc" value="studio" ${canStudio ? '' : 'disabled'}> <span>${m('📋 Panel Studio hiện tại (toàn bộ lựa chọn đang mở)')}</span></label>
      ${chDefault ? `<label class="as-radio"><input type="radio" name="asSrc" value="assistant"> <span>${m('🤖 Config trợ lý của kênh (đã lưu trong ⚙ Cài đặt trợ lý)')}</span></label>` : ''}
    </div>
    <div class="field as-block">
      <label class="label">${m('Ghi đè nhanh')} <span class="hint">${m('(chỉ mục nào bạn đổi mới được áp)')}</span></label>
      <div class="as-grid">
        <label>${m('Khung hình')} <select class="input" data-a="ar">
          <option value="">${m('(giữ nguyên)')}</option><option>9:16</option><option>16:9</option><option>1:1</option><option>4:5</option>
        </select></label>
        <label>${m('Thời lượng')} <select class="input" data-a="vd">
          <option value="">${m('(giữ nguyên)')}</option><option value="30">${m('30 giây')}</option><option value="60">${m('1 phút')}</option>
          <option value="90">${m('1,5 phút')}</option><option value="180">${m('3 phút')}</option><option value="300">${m('5 phút')}</option>
        </select></label>
        <label>${m('Phụ đề')} <select class="input" data-a="sub">
          <option value="">${m('(giữ nguyên)')}</option><option value="on">${m('Bật')}</option><option value="off">${m('Tắt')}</option>
        </select></label>
      </div>
    </div>
    <div class="field as-block">
      <label class="label">${m('Giọng đọc video này')}</label>
      <select class="input" data-a="voice">${voiceOptions()}</select>
    </div>
    <label class="as-radio" style="margin:2px 0 6px">
      <input type="checkbox" data-a="gate" ${mode === 'now' ? 'checked' : ''}>
      <span>${m('🔍 Duyệt kịch bản trước khi dựng')} <i class="hint">${mode === 'now'
    ? m('(dừng chờ bạn xem storyboard — chưa tốn phí lồng tiếng)')
    : m('(video hẹn lịch vốn chạy tự động — bật nếu muốn nó dừng chờ bạn duyệt)')}</i></span>
    </label>
    ${mode === 'schedule' ? `
    <div class="field as-block">
      <label class="label">${m('Thời điểm sản xuất')}</label>
      <input class="input" type="datetime-local" data-a="due" value="${due ? toLocalInput(due) : defaultDue()}">
    </div>` : ''}
    <div class="hint" id="asCost" style="margin:2px 0 4px"></div>
    <div class="hint" style="margin:4px 0 12px">${m('Máy chủ vẫn xếp lớp: mặc định app → kênh → preset mặc định → lựa chọn ở đây.')}</div>
    <div class="dlg-actions">
      <button class="btn" data-a="cancel">${m('Huỷ')}</button>
      <button class="btn primary" data-a="ok">${labels[1]}</button>
    </div>`, {
    onReady(dlg, close) {
      // picking a preset from the dropdown implies the preset source
      dlg.querySelector('[data-a=preset]')?.addEventListener('change', () => {
        const r = dlg.querySelector('input[name=asSrc][value=preset]');
        if (r && !r.disabled) r.checked = true;
      });
      // P34 cost preview — honest estimate line, refreshed when the duration override changes
      const costLine = dlg.querySelector('#asCost');
      const refreshCost = async () => {
        if (!costLine) return;
        try {
          const ch = (state.channels || []).find((c) => c.id === state.activeChannel);
          const vd = +(dlg.querySelector('[data-a=vd]')?.value) || ch?.config?.videoDuration || 60;
          const est = await api.post('/estimate-cost', { videoDuration: vd, config: { language: channelLang() } });
          const bits = [tp`~${est.scenes} cảnh`];
          if (est.credits != null) bits.push(tp`${fmtNum(est.credits)} credits LarVoice`);
          else if (est.ttsUsd) bits.push(tp`TTS ≈ $${est.ttsUsd.toFixed(2)}`);
          if (est.llmUsd != null) bits.push(tp`LLM ≈ $${est.llmUsd.toFixed(2)} (${est.basis})`);
          costLine.textContent = tp`💸 Ước tính: ${bits.join(' · ')}`;
        } catch { costLine.textContent = ''; }
      };
      refreshCost();
      dlg.querySelector('[data-a=vd]')?.addEventListener('change', refreshCost);
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
        if (v('vd')) { config.videoDuration = +v('vd'); config.durationMode = 'target'; } // an explicit duration pick must beat an inherited 'auto' — and ONLY then
        if (v('sub')) config.enableSubtitles = v('sub') === 'on';
        // the checkbox shows its state — what you see is what the run does (P34)
        config.sceneGate = !!dlg.querySelector('[data-a=gate]')?.checked;
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
    <div class="dlg-title">${m('🕐 Dời lịch sản xuất')}</div>
    <div class="dlg-body" style="margin-bottom:10px">${esc(slot.topic)}</div>
    <div class="field" style="margin-bottom:14px"><input class="input" type="datetime-local" data-a="due" value="${cur}"></div>
    <div class="dlg-actions">
      <button class="btn" data-a="cancel">${m('Huỷ')}</button>
      <button class="btn primary" data-a="ok">${m('🕐 Dời lịch')}</button>
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
    <div class="dlg-title">${m('📅 Lên kế hoạch tuần')}</div>
    <div class="dlg-body" style="margin-bottom:10px">${m('Tự xếp các gợi ý đang chờ (điểm viral cao trước) vào lịch sản xuất.')}</div>
    <div class="as-grid" style="margin-bottom:12px">
      <label>${m('Số ngày')} <select class="input" data-a="days">
        <option value="7">${m('7 ngày')}</option><option value="3">${m('3 ngày')}</option><option value="14">${m('14 ngày')}</option><option value="30">${m('30 ngày')}</option>
      </select></label>
      <label>${m('Video mỗi ngày')} <select class="input" data-a="perDay">
        <option value="1">1</option><option value="2">2</option><option value="3">3</option>
      </select></label>
    </div>
    <div class="field as-block">
      <label class="label">${m('Khung giờ (cách nhau bằng dấu phẩy)')}</label>
      <input class="input" data-a="times" value="${esc(prefTimes)}">
    </div>
    <label class="as-radio" style="margin-bottom:12px"><input type="checkbox" data-a="useStudio"> <span>${m('📋 Áp cấu hình từ panel Studio hiện tại cho mọi slot')}</span></label>
    <div class="dlg-actions">
      <button class="btn" data-a="cancel">${m('Huỷ')}</button>
      <button class="btn primary" data-a="ok">${m('📅 Xếp lịch')}</button>
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
          // kept out of the sentence below: a tp nested inside a tp is not extractable
          const rest = r.skipped ? tp` (còn ${r.skipped} chờ đợt sau)` : '';
          toast(r.planned
            ? tp`📅 Đã xếp ${r.planned} chủ đề vào lịch${rest}.`
            : m('Không có gợi ý đang chờ để xếp — tạo thêm gợi ý trước đã.'), r.planned ? 'success' : 'error');
          close(!!r.planned);
        } catch (e) { toast('✗ ' + e.message, 'error'); close(false); }
      });
    },
  });
}

/** Add a fixed weekly production window (weekday + time). Template only — never auto-runs. */
export function addRecurrenceDialog() {
  const days = [m('Chủ nhật'), m('Thứ 2'), m('Thứ 3'), m('Thứ 4'), m('Thứ 5'), m('Thứ 6'), m('Thứ 7')];
  return openDialog(`
    <div class="dlg-title">${m('⏰ Thêm khung giờ cố định')}</div>
    <div class="as-grid" style="margin-bottom:14px">
      <label>${m('Thứ')} <select class="input" data-a="wd">${days.map((d, i) => `<option value="${i}" ${i === 1 ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
      <label>${m('Giờ')} <input class="input" type="time" data-a="time" value="08:00"></label>
    </div>
    <div class="dlg-actions">
      <button class="btn" data-a="cancel">${m('Huỷ')}</button>
      <button class="btn primary" data-a="ok">${m('⏰ Thêm')}</button>
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
      const r = await api.post(`/topics/${row.id}/accept`, { config: picked.config, title: picked.title || null });
      toast('Đã đưa vào hàng đợi sản xuất 🎬', 'success');
      // P34: land the owner on the new project — the journal narrates from second one
      if (r?.projectId) { closeModal('#autopilotModal'); openProject(r.projectId); }
    } else {
      await api.post(`/topics/${row.id}/schedule`, { dueAt: picked.dueAt, config: picked.config, title: picked.title || null });
      toast('Đã hẹn lịch 🗓', 'success');
    }
    return true;
  } catch (e) { toast('✗ ' + e.message, 'error'); return false; }
}
