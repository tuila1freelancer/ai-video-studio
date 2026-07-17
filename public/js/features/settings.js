import { $, $$, esc, LANG_FLAGS } from '../ui/dom.js';
import { closeModal } from '../ui/modals.js';
import { toast } from '../ui/toast.js';
import { api } from '../api.js';
import { state } from '../state.js';

export function initSettings() {
  $('#setSave').addEventListener('click', saveSettings);
  $('#setTtsProvider').addEventListener('change', renderProviderFields);
  $('#btnTestProvider').addEventListener('click', testProvider);
  // per-language default voice rows are re-rendered often → one delegated listener
  $('#langVoiceList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rmlang]');
    if (b) removeLangVoice(b.dataset.rmlang);
  });
  // masked key fields ('ab12••'): select-all on focus so a paste REPLACES instead of appending
  $('#settingsModal').addEventListener('focusin', (e) => {
    const i = e.target;
    if (i.tagName === 'INPUT' && i.type === 'password' && i.value.includes('••')) i.select();
  });
}

export function openSettings() { $('#settingsModal').classList.add('open'); }

export async function loadVoices() {
  const { voices, providers } = await api.get('/voices');
  state.voiceCatalog = voices || [];
  state.providers = providers || [];
  $('#setTtsProvider').innerHTML = state.providers
    .map((p) => `<option value="${p.id}">${esc(p.name)}${p.free ? ' · miễn phí' : ''}</option>`).join('');
}
export async function loadSettings() {
  const { settings } = await api.get('/settings'); // masked '••' — server keeps real keys on round-trip
  state.settings = settings;
  $('#setLlmOn').checked = !!settings.llm?.enabled;
  $('#setLlmUrl').value = settings.llm?.baseUrl || '';
  $('#setLlmKey').value = settings.llm?.apiKey || ''; // masked — thấy là biết đã lưu
  $('#setLlmModel').value = settings.llm?.model || '';
  $('#setTtsProvider').value = settings.tts?.provider || 'edge';
  $('#setSubEngine').value = settings.subtitle?.engine || 'align'; // backend default is 'align' when unset
  if ($('#setSubLlmFix')) $('#setSubLlmFix').checked = settings.subtitle?.llmCorrect !== false;
  renderProviderFields();
  renderLangVoiceList();
}

// ---- dynamic per-provider config form (from configSchema) ----
function renderProviderFields() {
  const pid = $('#setTtsProvider').value || 'edge';
  const schema = (state.providers.find((p) => p.id === pid) || {}).configSchema || [];
  const saved = state.settings?.tts?.providers?.[pid] || {};
  $('#provFields').innerHTML = schema.length
    ? schema.map((f) => `<div class="field"><label class="label">${esc(f.label)}${f.required ? ' *' : ''}</label>
        <input class="input prov-field" data-key="${f.key}" type="${f.type === 'password' ? 'password' : 'text'}"
          placeholder="${esc(f.placeholder || '')}" value="${esc(saved[f.key] || '')}"></div>`).join('')
    : '<div class="hint" style="margin-bottom:8px">Provider này không cần cấu hình — dùng ngay.</div>';
  $('#provTestResult').textContent = '';
}
function collectProviderFields() {
  const out = {};
  $$('#provFields .prov-field').forEach((i) => { if (i.value.trim()) out[i.dataset.key] = i.value.trim(); });
  return out;
}
async function testProvider() {
  const pid = $('#setTtsProvider').value;
  $('#provTestResult').textContent = '⏳ đang kiểm tra…';
  const r = await api.post('/voices/test', { provider: pid, cfg: collectProviderFields() });
  $('#provTestResult').textContent = (r.ok ? '✅ ' : '❌ ') + (r.message || '');
  $('#provTestResult').style.color = r.ok ? 'var(--green)' : 'var(--red)';
}

// ---- per-language default voices table ----
function renderLangVoiceList() {
  const lv = state.settings?.tts?.langVoices || {};
  const rows = Object.entries(lv).map(([lang, v]) =>
    `<div>${LANG_FLAGS[lang] || '🏳️'} <strong>${lang}</strong> → ${esc(v.voice)} <span style="opacity:.6">(${esc(v.provider)})</span>
      <button class="btn sm danger" style="padding:1px 7px;font-size:10px" data-rmlang="${lang}">×</button></div>`).join('');
  $('#langVoiceList').innerHTML = rows || 'Chưa đặt — hệ thống tự chọn giọng theo ngôn ngữ văn bản.';
}
async function removeLangVoice(lang) {
  // deep-merge PUT: null = explicit delete (sending the object minus the key would resurrect it)
  await api.put('/settings', { tts: { langVoices: { [lang]: null } } });
  await loadSettings();
}

async function saveSettings() {
  const pid = $('#setTtsProvider').value;
  const oldTts = state.settings?.tts || {};
  const providers = { ...(oldTts.providers || {}) };
  providers[pid] = { ...(providers[pid] || {}), ...collectProviderFields() };
  const body = {
    llm: { enabled: $('#setLlmOn').checked, baseUrl: $('#setLlmUrl').value.trim(), model: $('#setLlmModel').value.trim(), apiKey: $('#setLlmKey').value || state.settings?.llm?.apiKey || '' },
    tts: { ...oldTts, provider: pid, providers },
    subtitle: { engine: $('#setSubEngine').value, llmCorrect: $('#setSubLlmFix') ? $('#setSubLlmFix').checked : true },
  };
  await api.put('/settings', body);
  await loadSettings();
  closeModal('#settingsModal');
  toast('Đã lưu cấu hình ✓', 'success');
}
