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
  // P42: check the LLM endpoint before saving it, not mid-render
  $('#btnTestLlm')?.addEventListener('click', async () => {
    const out = $('#llmTestResult');
    out.textContent = '⏳ đang kiểm tra…';
    const r = await api.post('/llm/test', {
      baseUrl: $('#setLlmUrl').value.trim(), apiKey: $('#setLlmKey').value.trim(), model: $('#setLlmModel').value.trim(),
    });
    out.textContent = (r.ok ? '✅ ' : '❌ ') + (r.message || '');
    out.style.color = r.ok ? 'var(--green)' : 'var(--red)';
  });
  // ---- publish destinations (P40) — the routes existed but nothing reached them ----
  $('#pubYtConnect')?.addEventListener('click', async () => {
    const body = { clientId: $('#pubYtId').value.trim(), clientSecret: $('#pubYtSecret').value.trim() };
    const r = await api.post('/publish/youtube/auth-url', body);
    if (r?.error) return toast(r.error, 'error');
    if (r?.url) { window.open(r.url, '_blank'); toast('Cho phép trên trình duyệt rồi quay lại đây.', 'success'); }
  });
  $('#pubFbConnect')?.addEventListener('click', async () => {
    const r = await api.post('/publish/facebook/connect', {
      pageId: $('#pubFbPage').value.trim(), pageToken: $('#pubFbToken').value.trim(),
    });
    if (r?.error) return toast(r.error, 'error');
    toast(`✅ Đã kết nối Page: ${r.pageName || r.pageId}`, 'success');
    loadPublishStatus();
  });
  $('#pubFbDisconnect')?.addEventListener('click', async () => {
    await api.post('/publish/facebook/disconnect', {});
    toast('Đã ngắt kết nối Page.', 'success');
    loadPublishStatus();
  });
}

// Which destinations are configured/connected right now.
export async function loadPublishStatus() {
  const el = $('#pubStatus');
  if (!el) return;
  try {
    const { platforms } = await api.get('/publish/status');
    el.innerHTML = (platforms || []).map((p) =>
      `${p.connected ? '🟢' : (p.configured ? '🟡' : '⚪️')} ${esc(p.name)}${p.connected ? ' — đã kết nối' : (p.configured ? ' — chưa kết nối' : ' — chưa cấu hình')}`).join(' · ')
      || 'Chưa có nền tảng nào.';
  } catch { el.textContent = 'Không đọc được trạng thái đăng video.'; }
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
  loadPublishStatus();
}

// ---- dynamic per-provider config form (from configSchema) ----
function renderProviderFields() {
  const pid = $('#setTtsProvider').value || 'edge';
  const schema = (state.providers.find((p) => p.id === pid) || {}).configSchema || [];
  const saved = state.settings?.tts?.providers?.[pid] || {};
  $('#provFields').innerHTML = schema.length
    ? schema.map((f) => (f.type === 'checkbox'
      // a boolean knob is a switch, not a box you type "true" into (P40: Supertonic autoStart)
      ? `<label class="switch-row"><span class="switch"><input type="checkbox" class="prov-field" data-key="${f.key}"${saved[f.key] ? ' checked' : ''}><span class="sl"></span></span> ${esc(f.label)}</label>`
      : `<div class="field"><label class="label">${esc(f.label)}${f.required ? ' *' : ''}</label>
        <input class="input prov-field" data-key="${f.key}" type="${f.type === 'password' ? 'password' : 'text'}"
          placeholder="${esc(f.placeholder || '')}" value="${esc(saved[f.key] || '')}"></div>`)).join('')
      + serverControls(pid)
    : '<div class="hint" style="margin-bottom:8px">Provider này không cần cấu hình — dùng ngay.</div>';
  $('#provTestResult').textContent = '';
  wireServerControls(pid);
}
function collectProviderFields() {
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
  return `<div class="field"><label class="label">Server cục bộ</label>
    <button class="btn sm" id="ttsSrvStart">▶ Khởi động</button>
    <button class="btn sm" id="ttsSrvStop">⏹ Dừng</button>
    <button class="btn sm" id="ttsSrvStatus">🔄 Kiểm tra</button>
    <button class="btn sm" id="ttsSrvInstall">⬇ Cài đặt</button>
    <div class="hint" id="ttsSrvOut" style="margin-top:6px">Cài một lần: <code>pip install supertonic</code></div></div>`;
}
function wireServerControls(pid) {
  if (pid !== 'supertonic') return;
  const out = $('#ttsSrvOut');
  const show = (r) => {
    const s = r?.supertonic || {};
    out.textContent = r?.error
      ? `❌ ${r.error}`
      : `${s.running ? '🟢 đang chạy' : '⚪️ chưa chạy'} · ${s.url || ''}${s.installed ? '' : ' · chưa cài (pip install supertonic)'}`;
  };
  $('#ttsSrvStart')?.addEventListener('click', async () => {
    out.textContent = '⏳ đang khởi động…';
    show(await api.post('/tts/server/start', collectProviderFields()));
  });
  $('#ttsSrvStop')?.addEventListener('click', async () => {
    const r = await api.post('/tts/server/stop', {});
    out.textContent = r?.error ? `❌ ${r.error}` : (r?.stopped ? '⏹ đã dừng' : 'không có server nào do app quản lý');
  });
  $('#ttsSrvStatus')?.addEventListener('click', async () => show(await api.get('/tts/server/status')));
  $('#ttsSrvInstall')?.addEventListener('click', async () => {
    out.textContent = '⏳ đang cài (pip install supertonic) — có thể mất vài phút…';
    const r = await api.post('/tts/server/install', {});
    out.textContent = (r.ok ? '✅ ' : '❌ ') + (r.message || r.error || '');
  });
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
