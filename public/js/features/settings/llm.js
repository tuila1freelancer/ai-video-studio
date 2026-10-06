// The LLM provider picker: presets, per-provider account stash, model suggestions, the connection test.
import { $, esc } from '../../ui/dom.js';
import { api } from '../../api.js';
import { state } from '../../state.js';
import { t, m, tp } from '../../i18n.js';

// ---- LLM provider picker (ai-providers) ----
// Typing a base URL from memory was the single biggest thing standing between "installed" and
// "actually using the AI stages". The catalogue lives on the server (providers/llm-presets.js);
// this only renders it.
//
// Built per render, never at module load: m() only has a catalogue once initI18n has run.
const tierLabels = () => ({
  free: m('Miễn phí — không cần thẻ'),
  cheap: m('Giá rẻ — trả theo lượng dùng'),
  premium: m('Cao cấp'),
  local: m('Chạy trên máy bạn'),
  custom: m('Khác'),
});

export async function loadLlmPresets() {
  try {
    state.llmPresets = (await api.get('/llm/providers')).presets || [];
  } catch { state.llmPresets = []; /* offline — the picker degrades to the custom entry */ }
  // The LLM picker offers ONLY what can serve the LLM lane. Groq/Together/OpenAI stay in the
  // catalogue for the image and TTS pickers but have no Gemini, and the script and the HyperFrame
  // graphics run off this one setting — offering a provider that makes the second half fail is
  // not a choice, it is a trap.
  const forLlm = state.llmPresets.filter((p) => p.lanes?.llm);
  const html = Object.entries(tierLabels()).map(([tier, label]) => {
    const rows = forLlm.filter((p) => p.tier === tier);
    if (!rows.length) return '';
    return `<optgroup label="${esc(label)}">${rows.map((p) =>
      `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('')}</optgroup>`;
  }).join('');
  $('#setLlmPreset').innerHTML = html || `<option value="custom">${esc(m('✏️ Tuỳ chỉnh (tự nhập Base URL)'))}</option>`;
}

const normUrl = (u) => String(u || '').trim().toLowerCase().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');

// An install that predates the picker saved a base URL and nothing else. Recognise it rather
// than dropping the user into "Tuỳ chỉnh" and making them re-pick what they already have.
export function inferPresetId(baseUrl) {
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
/** loadSettings() starts from the saved state: nothing is on screen yet. */
export function forgetShownPreset() { llmShownPreset = null; }

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
export function stashLlmAccount() {
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

export function renderLlmPreset() {
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
  $('#setLlmKey').placeholder = acc.apiKey ? 'sk-...' : tp`dán API key của ${p?.label || 'provider'}…`;
  $('#setLlmModel').value = acc.model;
  $('#setLlmCodegenModel').value = acc.codegenModel;
  llmShownPreset = id;

  // HyperFrame writes the scene graphics as code and only Gemini writes markup that renders.
  // Codegen also runs with no fallback, so a provider without Gemini does not degrade — it
  // fails ten attempts deep, mid-render, naming a model the user never chose. This is the one
  // place the app can say so before that happens.
  const hasGemini = /gemini/i.test(acc.codegenModel || p?.codegenModel || '');
  $('#llmCodegenWarn').innerHTML = hasGemini
    ? esc(t('ui.settings.dung-do-hoa-bang', { model: acc.codegenModel || p.codegenModel }, 'Dựng đồ hoạ bằng {model}.'))
      .replace(esc(acc.codegenModel || p.codegenModel), `<strong>${esc(acc.codegenModel || p.codegenModel)}</strong>`)
    : esc(t('ui.settings.chua-co-model-gemini', null, '⚠️ Chưa có model Gemini — nhập tên model Gemini mà endpoint của bạn phục vụ.'));
  $('#llmCodegenWarn').style.color = hasGemini ? 'var(--muted)' : 'var(--red)';

  $('#btnFetchModels').disabled = !(p?.listsModels ?? true);
  $('#llmModelsOut').textContent = '';
  const badges = [];
  if (p?.noCard && !p?.keyless) badges.push(m('🎁 không cần thẻ'));
  if (p?.keyless) badges.push(m('💻 không cần key'));
  if (p && !p.modelsVerified && p.models?.length) badges.push(m('↻ nên lấy lại danh sách model'));
  $('#llmPresetNote').innerHTML = [
    p?.note ? esc(p.note) : '',
    esc(badges.join(' · ')),
    // A local server has no key to fetch — its link is where to download the thing.
    p?.keyUrl ? `<a href="${esc(p.keyUrl)}" target="_blank" rel="noreferrer noopener">${p.keyless ? esc(m('⬇ Tải phần mềm ↗')) : esc(m('🔑 Lấy API key ↗'))}</a>` : '',
  ].filter(Boolean).join('<br>');
  setModelSuggestions(p?.models || []);
}

// A datalist, not a select: a suggestion list must never stop the user typing a model the
// app has not heard of — and a select would silently blank a saved value it has no option for.
function setModelSuggestions(models) {
  // `mo`, not `m`: the parameter must not shadow the m() the free-price branch calls.
  $('#llmModelList').innerHTML = models.map((mo) => {
    const p = mo.price;
    const price = Array.isArray(p) ? (p[0] || p[1] ? tp`$${p[0]}/$${p[1]} mỗi 1M token` : m('miễn phí')) : '';
    return `<option value="${esc(mo.id)}">${esc([mo.label, price].filter(Boolean).join(' — '))}</option>`;
  }).join('');
}

/** The per-provider credential map as it should be persisted, including the field values on
 *  screen right now. Masked keys ('ab12••') are sent back deliberately: that is the round-trip
 *  the server reads as "keep the one you already have". */
export function llmAccountsForSave() {
  stashLlmAccount();
  const out = {};
  for (const [id, acc] of Object.entries(state.llmAccounts || {})) {
    // deep-merge PUT: null = explicit delete. Emptying a provider's key has to actually
    // forget it — omitting the entry would silently keep the old one.
    out[id] = (acc?.apiKey || acc?.model || acc?.baseUrl) ? { ...acc } : null;
  }
  return out;
}

export async function fetchLlmModels() {
  const out = $('#llmModelsOut');
  out.textContent = m('⏳ đang hỏi provider…');
  out.style.color = '';
  const r = await api.post('/llm/models', {
    preset: $('#setLlmPreset').value, baseUrl: $('#setLlmUrl').value.trim(), apiKey: $('#setLlmKey').value.trim(),
  });
  if (!r?.ok) {
    // A provider that cannot list its models is not a broken provider — keep the suggestions.
    out.textContent = `❌ ${r?.message || m('không lấy được danh sách')}`;
    out.style.color = 'var(--red)';
    return;
  }
  setModelSuggestions(r.models.map((id) => ({ id, label: '', price: null })));
  out.textContent = tp`✅ ${r.models.length} model — bấm vào ô Model để chọn`;
  out.style.color = 'var(--green)';
}
