// The AI Setting modal: interface-language picker, wiring, load and save.
import { $, esc } from '../../ui/dom.js';
import { closeModal } from '../../ui/modals.js';
import { toast } from '../../ui/toast.js';
import { api } from '../../api.js';
import { state } from '../../state.js';
import { uiLang, setUiLanguage, m, tp } from '../../i18n.js';
import { loadFbPages, loadPublishStatus } from './publish.js';
import { loadLlmPresets, inferPresetId, stashLlmAccount, renderLlmPreset, llmAccountsForSave, fetchLlmModels, forgetShownPreset } from './llm.js';
import { renderProviderFields, testProvider, renderLangVoiceList, removeLangVoice, collectProviderFields } from './tts.js';
import { initAgentPanel, loadAgent } from './agent.js';
import { LANGS } from '../../ui/langs.js';

// The languages the app can be shown in, named in themselves — a picker that says "Japanese" to
// someone who cannot read English is a picker they cannot use.
// i18n-exempt: endonyms — a language names itself, so the picker stays usable in any interface.

function initUiLangPicker() {
  const sel = $('#setUiLang');
  if (!sel) return;
  sel.innerHTML = LANGS.map(([c, label]) => `<option value="${c}">${esc(label)}</option>`).join('');
  sel.value = uiLang();
  sel.addEventListener('change', () => { if (sel.value !== uiLang()) setUiLanguage(sel.value, api); });
}

export function initSettings() {
  initUiLangPicker();
  initAgentPanel({ onGuide: openAgentChapter });
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
  // ai-providers: switching provider rewrites the base URL, the key link and the model suggestions.
  $('#setLlmPreset')?.addEventListener('change', () => { stashLlmAccount(); renderLlmPreset(); });
  $('#btnFetchModels')?.addEventListener('click', fetchLlmModels);
  // P42: check the LLM endpoint before saving it, not mid-render
  $('#btnTestLlm')?.addEventListener('click', async () => {
    const out = $('#llmTestResult');
    out.textContent = m('⏳ đang kiểm tra…');
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
    toast(tp`✅ Đã kết nối Page: ${r.pageName || r.pageId}`, 'success');
    loadPublishStatus(); loadFbPages();
  });
  $('#pubFbRefresh')?.addEventListener('click', () => { loadPublishStatus(); loadFbPages(); });
  $('#pubFbDisconnect')?.addEventListener('click', async () => {
    await api.post('/publish/facebook/disconnect', {});
    toast('Đã ngắt kết nối Page.', 'success');
    loadPublishStatus();
  });
}

export function openSettings() { $('#settingsModal').classList.add('open'); }

/** The manual, at the chapter this panel is about. Built before scrolling, so the anchor exists. */
async function openAgentChapter() {
  closeModal('#settingsModal');
  (await import('../../views/nav.js')).switchPage('tutorials');
  await (await import('../../views/guide.js')).openGuide();
  document.getElementById('gd-agent')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export async function loadVoices() {
  const { voices, providers } = await api.get('/voices');
  state.voiceCatalog = voices || [];
  state.providers = providers || [];
  $('#setTtsProvider').innerHTML = state.providers
    .map((p) => `<option value="${p.id}">${esc(p.name)}${p.free ? ' · ' + esc(m('miễn phí')) : ''}</option>`).join('');
}

export async function loadSettings() {
  const { settings } = await api.get('/settings', { ttl: 5000 }); // masked '••' — server keeps real keys on round-trip
  state.settings = settings;
  await loadLlmPresets();
  $('#setLlmOn').checked = !!settings.llm?.enabled;
  $('#setLlmPreset').value = settings.llm?.preset || inferPresetId(settings.llm?.baseUrl);
  if (!$('#setLlmPreset').value) $('#setLlmPreset').value = 'custom'; // a preset we no longer ship
  // Every provider the owner has ever configured, plus the active one — whose credentials live
  // at the top level because that is what the LLM lane actually reads.
  forgetShownPreset();
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
  loadAgent(settings);
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
