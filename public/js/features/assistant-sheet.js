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

function defaultDue() {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T08:00`;
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

/**
 * Open the sheet for one suggestion row. Resolves {config, title?, dueAt?} on confirm,
 * null on cancel. `mode`: 'now' creates immediately, 'schedule' adds a datetime field.
 */
export function configSheet({ row, mode }) {
  const titles = Array.isArray(row.titles) ? row.titles.filter(Boolean) : [];
  const presets = state.presets || [];
  const canStudio = !!document.getElementById('cfgVisualMode');
  return openDialog(`
    <div class="dlg-title">${mode === 'now' ? '🎬 Tạo video từ gợi ý' : '🗓 Hẹn lịch sản xuất'}</div>
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
      <input class="input" type="datetime-local" data-a="due" value="${defaultDue()}">
    </div>` : ''}
    <div class="hint" style="margin:4px 0 12px">Máy chủ vẫn xếp lớp: mặc định app → kênh → preset mặc định → lựa chọn ở đây.</div>
    <div class="dlg-actions">
      <button class="btn" data-a="cancel">Huỷ</button>
      <button class="btn primary" data-a="ok">${mode === 'now' ? '🎬 Tạo ngay' : '🗓 Hẹn lịch'}</button>
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
        }
        const v = (a) => dlg.querySelector(`[data-a=${a}]`)?.value || '';
        if (v('ar')) config.aspectRatio = v('ar');
        if (v('vd')) config.videoDuration = +v('vd');
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

/**
 * Full owner flow for a pending suggestion: sheet → API call → toast.
 * Returns true when something was created/changed (callers refresh their views).
 */
export async function runSuggestionAction(row, act) {
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
  const picked = await configSheet({ row, mode });
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
