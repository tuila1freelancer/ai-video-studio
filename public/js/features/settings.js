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
  // P45: switching provider rewrites the base URL, the key link and the model suggestions.
  $('#setLlmPreset')?.addEventListener('change', () => { stashLlmAccount(); renderLlmPreset(); });
  $('#btnFetchModels')?.addEventListener('click', fetchLlmModels);
  // P42: check the LLM endpoint before saving it, not mid-render
  $('#btnTestLlm')?.addEventListener('click', async () => {
    const out = $('#llmTestResult');
    out.textContent = '⏳ đang kiểm tra…';
    const r = await api.post('/llm/test', {
      preset: $('#setLlmPreset').value,
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
    loadPublishStatus(); loadFbPages();
  });
  $('#pubFbRefresh')?.addEventListener('click', () => { loadPublishStatus(); loadFbPages(); });
  $('#pubFbDisconnect')?.addEventListener('click', async () => {
    await api.post('/publish/facebook/disconnect', {});
    toast('Đã ngắt kết nối Page.', 'success');
    loadPublishStatus();
  });
}

// Every connected Page, which one is active, and whether its token is still good (P43 — the
// registry existed since P42 but nothing showed it).
export async function loadFbPages() {
  const box = $('#pubFbPages');
  if (!box) return;
  let pages = [];
  try { pages = (await api.get('/publish/pages')).pages || []; } catch { return; }
  if (!pages.length) { box.innerHTML = '<span style="opacity:.6">Chưa kết nối Page nào.</span>'; return; }
  box.innerHTML = pages.map((p) => `<div>${p.active ? '🟢' : '⚪️'} <strong>${esc(p.name || p.id)}</strong>
    <button class="btn sm" data-fbsel="${esc(p.id)}">Dùng</button>
    <button class="btn sm" data-fbchk="${esc(p.id)}">Kiểm tra token</button>
    <button class="btn sm danger" data-fbdel="${esc(p.id)}">Xoá</button>
    <span data-fbinfo="${esc(p.id)}"></span></div>`).join('');
  box.querySelectorAll('[data-fbsel]').forEach((b) => { b.onclick = async () => { await api.post(`/publish/pages/${b.dataset.fbsel}/select`, {}); loadFbPages(); loadPublishStatus(); }; });
  box.querySelectorAll('[data-fbdel]').forEach((b) => { b.onclick = async () => { await api.del(`/publish/pages/${b.dataset.fbdel}`); loadFbPages(); loadPublishStatus(); }; });
  box.querySelectorAll('[data-fbchk]').forEach((b) => {
    b.onclick = async () => {
      const info = box.querySelector(`[data-fbinfo="${b.dataset.fbchk}"]`);
      info.textContent = '⏳';
      const r = await api.post(`/publish/pages/${b.dataset.fbchk}/check`, {});
      info.textContent = r?.error ? `❌ ${r.error}`
        : (r.neverExpires ? '✅ token không hết hạn' : (r.valid ? `✅ còn ${r.daysLeft} ngày` : '❌ token đã hỏng'));
    };
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
// ---- LLM provider picker (P45) ----
// Typing a base URL from memory was the single biggest thing standing between "installed" and
// "actually using the AI stages". The catalogue lives on the server (providers/llm-presets.js);
// this only renders it.
const TIER_LABELS = {
  free: 'Miễn phí — không cần thẻ',
  cheap: 'Giá rẻ — trả theo lượng dùng',
  premium: 'Cao cấp',
  local: 'Chạy trên máy bạn',
  custom: 'Khác',
};

export async function loadLlmPresets() {
  try {
    state.llmPresets = (await api.get('/llm/providers')).presets || [];
  } catch { state.llmPresets = []; /* offline — the picker degrades to the custom entry */ }
  const html = Object.entries(TIER_LABELS).map(([tier, label]) => {
    const rows = state.llmPresets.filter((p) => p.tier === tier);
    if (!rows.length) return '';
    return `<optgroup label="${esc(label)}">${rows.map((p) =>
      // Only a provider that serves Gemini can drive HyperFrame, and that is the one thing
      // worth flagging in the list itself. Not on "Tuỳ chỉnh": an arbitrary endpoint keeps the
      // model this app has always pinned, which is a legacy default, not a promise.
      `<option value="${esc(p.id)}">${esc(p.label)}${p.codegenModel && p.id !== 'custom' ? ' · dựng được đồ hoạ' : ''}</option>`).join('')}</optgroup>`;
  }).join('');
  $('#setLlmPreset').innerHTML = html || '<option value="custom">✏️ Tuỳ chỉnh (tự nhập Base URL)</option>';
}

const normUrl = (u) => String(u || '').trim().toLowerCase().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');

// An install that predates the picker saved a base URL and nothing else. Recognise it rather
// than dropping the owner into "Tuỳ chỉnh" and making them re-pick what they already have.
function inferPresetId(baseUrl) {
  const key = normUrl(baseUrl);
  if (!key) return 'custom';
  const exact = state.llmPresets.find((p) => p.baseUrl && normUrl(p.baseUrl) === key);
  if (exact) return exact.id;
  try {
    const host = new URL(key).host;
    return state.llmPresets.find((p) => p.baseUrl && new URL(p.baseUrl).host === host)?.id || 'custom';
  } catch { return 'custom'; }
}

const currentPreset = () => state.llmPresets?.find((p) => p.id === $('#setLlmPreset').value) || null;

// Each provider keeps its OWN key, model and (for a custom endpoint) base URL — a key belongs
// to one provider and to no other. Two things fall out of that. Trying another provider and
// coming back costs nothing, so the picker is safe to explore. And the previous provider's key
// never sits in the box under a new provider's name, which is how someone picks Gemini, sees a
// filled field, saves, and then wonders why every AI stage quietly fell back to the offline
// generator: llmEnabled stays true, the calls just fail.
//
// The map is persisted under settings.llm.accounts, so it survives a restart. Keys ride the
// same masking contract as everything else: '••' on the way out, '••' means "keep" on the way
// back in (util/secrets.js recurses into plain objects).
let llmShownPreset = null; // whose values are in the fields right now

function llmAccount(id) {
  const p = state.llmPresets?.find((x) => x.id === id);
  const saved = state.llmAccounts?.[id];
  return {
    apiKey: saved?.apiKey || '',
    model: saved?.model || p?.models?.[0]?.id || '',
    baseUrl: saved?.baseUrl || p?.baseUrl || '',
    codegenModel: saved?.codegenModel || '',
  };
}

/** Remember what is on screen before the picker moves somewhere else. */
function stashLlmAccount() {
  if (!llmShownPreset) return;
  const p = state.llmPresets?.find((x) => x.id === llmShownPreset);
  state.llmAccounts = state.llmAccounts || {};
  state.llmAccounts[llmShownPreset] = {
    apiKey: $('#setLlmKey').value,
    model: $('#setLlmModel').value.trim(),
    codegenModel: $('#setLlmCodegenModel').value.trim(),
    // Only a custom endpoint owns its URL. Storing the catalogue's URL back would make every
    // entry permanently non-empty, and clearing a key could then never forget the provider.
    ...(p?.baseUrl ? {} : { baseUrl: $('#setLlmUrl').value.trim() }),
  };
}

function renderLlmPreset() {
  const p = currentPreset();
  const isCustom = !p || p.id === 'custom';
  const id = $('#setLlmPreset').value || 'custom';
  const acc = llmAccount(id);

  // The base URL stays the field the request is actually built from — the preset only fills
  // it in. Hiding it is a UI decision; nothing downstream had to learn about presets.
  $('#llmUrlField').classList.toggle('hidden', !isCustom);
  $('#setLlmUrl').value = isCustom ? acc.baseUrl : p.baseUrl;
  $('#llmKeyField').classList.toggle('hidden', !!p?.keyless);
  $('#setLlmKey').value = acc.apiKey;
  $('#setLlmKey').placeholder = acc.apiKey ? 'sk-...' : `dán API key của ${p?.label || 'provider'}…`;
  $('#setLlmModel').value = acc.model;
  $('#setLlmCodegenModel').value = acc.codegenModel;
  llmShownPreset = id;

  // HyperFrame writes the scene graphics as code and only Gemini writes markup that renders.
  // Codegen also runs with no fallback, so a provider without Gemini does not degrade — it
  // fails ten attempts deep, mid-render, naming a model the owner never chose. This is the one
  // place the app can say so before that happens.
  const hasGemini = /gemini/i.test(acc.codegenModel || p?.codegenModel || '');
  $('#llmCodegenWarn').innerHTML = hasGemini
    ? '✅ Khâu dựng đồ hoạ sẽ chạy bằng <strong>' + esc(acc.codegenModel || p.codegenModel) + '</strong>.'
    : '⚠️ <strong>Nhà cung cấp này không có model Gemini.</strong> Chỉ Gemini dựng được đồ hoạ HyperFrame '
      + '— hãy chọn Google Gemini hoặc OpenRouter, hoặc nếu endpoint của bạn có phục vụ Gemini dưới tên khác thì nhập tên đó vào ô này.';
  $('#llmCodegenWarn').style.color = hasGemini ? 'var(--muted)' : 'var(--red)';

  $('#btnFetchModels').disabled = !(p?.listsModels ?? true);
  $('#llmModelsOut').textContent = '';
  const badges = [];
  if (p?.noCard && !p?.keyless) badges.push('🎁 dùng được ngay, không cần thẻ');
  if (p?.keyless) badges.push('💻 không cần API key');
  if (p && !p.modelsVerified && p.models?.length) badges.push('↻ nên bấm lấy danh sách model cho chắc');
  $('#llmPresetNote').innerHTML = [
    p?.note ? esc(p.note) : '',
    badges.join(' · '),
    // A local server has no key to fetch — its link is where to download the thing.
    p?.keyUrl ? `<a href="${esc(p.keyUrl)}" target="_blank" rel="noreferrer noopener">${p.keyless ? '⬇ Tải phần mềm ↗' : '🔑 Lấy API key ↗'}</a>` : '',
  ].filter(Boolean).join('<br>');
  setModelSuggestions(p?.models || []);
}

// A datalist, not a select: a suggestion list must never stop the owner typing a model the
// app has not heard of — and a select would silently blank a saved value it has no option for.
function setModelSuggestions(models) {
  $('#llmModelList').innerHTML = models.map((m) => {
    const p = m.price;
    const price = Array.isArray(p) ? (p[0] || p[1] ? `$${p[0]}/$${p[1]} mỗi 1M token` : 'miễn phí') : '';
    return `<option value="${esc(m.id)}">${esc([m.label, price].filter(Boolean).join(' — '))}</option>`;
  }).join('');
}

/** The per-provider credential map as it should be persisted, including the field values on
 *  screen right now. Masked keys ('ab12••') are sent back deliberately: that is the round-trip
 *  the server reads as "keep the one you already have". */
function llmAccountsForSave() {
  stashLlmAccount();
  const out = {};
  for (const [id, acc] of Object.entries(state.llmAccounts || {})) {
    // deep-merge PUT: null = explicit delete. Emptying a provider's key has to actually
    // forget it — omitting the entry would silently keep the old one.
    out[id] = (acc?.apiKey || acc?.model || acc?.baseUrl) ? { ...acc } : null;
  }
  return out;
}

async function fetchLlmModels() {
  const out = $('#llmModelsOut');
  out.textContent = '⏳ đang hỏi provider…';
  out.style.color = '';
  const r = await api.post('/llm/models', {
    preset: $('#setLlmPreset').value, baseUrl: $('#setLlmUrl').value.trim(), apiKey: $('#setLlmKey').value.trim(),
  });
  if (!r?.ok) {
    // A provider that cannot list its models is not a broken provider — keep the suggestions.
    out.textContent = `❌ ${r?.message || 'không lấy được danh sách'}`;
    out.style.color = 'var(--red)';
    return;
  }
  setModelSuggestions(r.models.map((id) => ({ id, label: '', price: null })));
  out.textContent = `✅ ${r.models.length} model — bấm vào ô Model để chọn`;
  out.style.color = 'var(--green)';
}

export async function loadSettings() {
  const { settings } = await api.get('/settings'); // masked '••' — server keeps real keys on round-trip
  state.settings = settings;
  await loadLlmPresets();
  $('#setLlmOn').checked = !!settings.llm?.enabled;
  $('#setLlmPreset').value = settings.llm?.preset || inferPresetId(settings.llm?.baseUrl);
  if (!$('#setLlmPreset').value) $('#setLlmPreset').value = 'custom'; // a preset we no longer ship
  // Every provider the owner has ever configured, plus the active one — whose credentials live
  // at the top level because that is what the LLM lane actually reads.
  llmShownPreset = null;
  state.llmAccounts = { ...(settings.llm?.accounts || {}) };
  state.llmAccounts[$('#setLlmPreset').value] = {
    apiKey: settings.llm?.apiKey || '', model: settings.llm?.model || '', baseUrl: settings.llm?.baseUrl || '',
  };
  renderLlmPreset();
  $('#setTtsProvider').value = settings.tts?.provider || 'edge';
  $('#setSubEngine').value = settings.subtitle?.engine || 'align'; // backend default is 'align' when unset
  if ($('#setSubLlmFix')) $('#setSubLlmFix').checked = settings.subtitle?.llmCorrect !== false;
  renderProviderFields();
  renderLangVoiceList();
  loadPublishStatus();
  loadFbPages();
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
    llm: {
      enabled: $('#setLlmOn').checked,
      // Saved alongside the URL, not instead of it: the request is still built from baseUrl,
      // and storing the id makes the panel show the right provider without re-inferring it.
      preset: $('#setLlmPreset').value || 'custom',
      baseUrl: $('#setLlmUrl').value.trim(),
      model: $('#setLlmModel').value.trim(),
      codegenModel: $('#setLlmCodegenModel').value.trim(),
      apiKey: $('#setLlmKey').value,
      // …and every other provider the owner has set up keeps its own credentials, so
      // switching back to one is instant instead of a trip to a dashboard for a new key.
      accounts: llmAccountsForSave(),
    },
    tts: { ...oldTts, provider: pid, providers },
    subtitle: { engine: $('#setSubEngine').value, llmCorrect: $('#setSubLlmFix') ? $('#setSubLlmFix').checked : true },
  };
  await api.put('/settings', body);
  await loadSettings();
  closeModal('#settingsModal');
  toast('Đã lưu cấu hình ✓', 'success');
}
