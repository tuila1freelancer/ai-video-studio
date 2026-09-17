// The TTS provider form from configSchema, local-server controls, the per-language voice table.
import { $, $$, LANG_FLAGS, esc } from '../../ui/dom.js';
import { api } from '../../api.js';
import { state } from '../../state.js';
import { m } from '../../i18n.js';
import { loadSettings } from './index.js';

// ---- dynamic per-provider config form (from configSchema) ----
export function renderProviderFields() {
  const pid = $('#setTtsProvider').value || 'edge';
  const schema = (state.providers.find((p) => p.id === pid) || {}).configSchema || [];
  const saved = state.settings?.tts?.providers?.[pid] || {};
  $('#provFields').innerHTML = schema.length
    ? schema.map((f) => (f.type === 'checkbox'
      // a boolean knob is a switch, not a box you type "true" into (P40: Supertonic autoStart)
      ? `<label class="switch-row"><span class="switch"><input type="checkbox" class="prov-field" data-key="${f.key}"${saved[f.key] ? ' checked' : ''}><span class="sl"></span></span> ${esc(f.label)}</label>`
      // a closed set of choices is a dropdown, not a string to spell right (ai-providers: TTS presets)
      : f.type === 'select'
      ? `<div class="field"><label class="label">${esc(f.label)}</label>
        <select class="input prov-field" data-key="${f.key}">${(f.options || []).map((o) =>
          `<option value="${esc(o.value)}"${saved[f.key] === o.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>`
      : `<div class="field"><label class="label">${esc(f.label)}${f.required ? ' *' : ''}</label>
        <input class="input prov-field" data-key="${f.key}" type="${f.type === 'password' ? 'password' : 'text'}"
          placeholder="${esc(f.placeholder || '')}" value="${esc(saved[f.key] || '')}"></div>`)).join('')
      + serverControls(pid)
    : `<div class="hint" style="margin-bottom:8px">${esc(m('Provider này không cần cấu hình — dùng ngay.'))}</div>`;
  $('#provTestResult').textContent = '';
  wireServerControls(pid);
}
export function collectProviderFields() {
  const out = {};
  $$('#provFields .prov-field').forEach((i) => {
    if (i.type === 'checkbox') out[i.dataset.key] = i.checked;
    else if (i.value.trim()) out[i.dataset.key] = i.value.trim();
  });
  return out;
}

// A LOCAL provider needs a process, not a key — offer start/stop/status right where it is
// configured (P40, Supertonic).
function serverControls(pid) {
  if (pid !== 'supertonic') return '';
  return `<div class="field"><label class="label">${esc(m('Server cục bộ'))}</label>
    <button class="btn sm" id="ttsSrvStart">${esc(m('▶ Khởi động'))}</button>
    <button class="btn sm" id="ttsSrvStop">${esc(m('⏹ Dừng'))}</button>
    <button class="btn sm" id="ttsSrvStatus">${esc(m('🔄 Kiểm tra'))}</button>
    <button class="btn sm" id="ttsSrvInstall">${esc(m('⬇ Cài đặt'))}</button>
    <div class="hint" id="ttsSrvOut" style="margin-top:6px">${esc(m('Cài một lần:'))} <code>pip install supertonic</code></div></div>`;
}
function wireServerControls(pid) {
  if (pid !== 'supertonic') return;
  const out = $('#ttsSrvOut');
  const show = (r) => {
    const s = r?.supertonic || {};
    out.textContent = r?.error
      ? `❌ ${r.error}`
      : `${s.running ? m('🟢 đang chạy') : m('⚪️ chưa chạy')} · ${s.url || ''}${s.installed ? '' : ' · ' + m('chưa cài (pip install supertonic)')}`;
  };
  $('#ttsSrvStart')?.addEventListener('click', async () => {
    out.textContent = m('⏳ đang khởi động…');
    show(await api.post('/tts/server/start', collectProviderFields()));
  });
  $('#ttsSrvStop')?.addEventListener('click', async () => {
    const r = await api.post('/tts/server/stop', {});
    out.textContent = r?.error ? `❌ ${r.error}` : (r?.stopped ? m('⏹ đã dừng') : m('không có server nào do app quản lý'));
  });
  $('#ttsSrvStatus')?.addEventListener('click', async () => show(await api.get('/tts/server/status')));
  $('#ttsSrvInstall')?.addEventListener('click', async () => {
    out.textContent = m('⏳ đang cài (pip install supertonic) — có thể mất vài phút…');
    const r = await api.post('/tts/server/install', {});
    out.textContent = (r.ok ? '✅ ' : '❌ ') + (r.message || r.error || '');
  });
}
export async function testProvider() {
  const pid = $('#setTtsProvider').value;
  $('#provTestResult').textContent = m('⏳ đang kiểm tra…');
  const r = await api.post('/voices/test', { provider: pid, cfg: collectProviderFields() });
  $('#provTestResult').textContent = (r.ok ? '✅ ' : '❌ ') + (r.message || '');
  $('#provTestResult').style.color = r.ok ? 'var(--green)' : 'var(--red)';
}

// ---- per-language default voices table ----
export function renderLangVoiceList() {
  const lv = state.settings?.tts?.langVoices || {};
  const rows = Object.entries(lv).map(([lang, v]) =>
    `<div>${LANG_FLAGS[lang] || '🏳️'} <strong>${lang}</strong> → ${esc(v.voice)} <span style="opacity:.6">(${esc(v.provider)})</span>
      <button class="btn sm danger" style="padding:1px 7px;font-size:10px" data-rmlang="${lang}">×</button></div>`).join('');
  $('#langVoiceList').innerHTML = rows || esc(m('Chưa đặt — hệ thống tự chọn giọng theo ngôn ngữ văn bản.'));
}
export async function removeLangVoice(lang) {
  // deep-merge PUT: null = explicit delete (sending the object minus the key would resurrect it)
  await api.put('/settings', { tts: { langVoices: { [lang]: null } } });
  await loadSettings();
}
