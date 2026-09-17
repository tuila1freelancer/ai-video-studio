// The font pickers, fed from /fonts/families — the app's ONE list — and the lazy loading of a
// family's real bytes so a preview never paints the system sans-serif and calls it Anton.
import { $, esc } from '../../ui/dom.js';
import { api } from '../../api.js';
import { state } from '../../state.js';
import { m } from '../../i18n.js';
import { syncSubWeights, updateSubPreview } from '../config.js';

// Both pickers are built from /fonts/families, which is the app's ONE list. index.html used to
// carry ten hard-coded <option>s, two of which (Arial, Impact) existed in neither the vendored
// CSS nor the burn directory — so the owner could pick a font the renderer had never heard of
// and nothing anywhere said so.
const SOURCE_MARK = { uploaded: '📤 ', downloaded: '⬇︎ ', system: '🖥 ', downloadable: '☁️ ' };
const loadedFaces = new Set();

/**
 * Pull a family's real bytes into the page before anything claims to show it.
 *
 * The old preview just set `fontFamily` and hoped. The app's own stylesheet only ever loaded
 * Lexend and JetBrains Mono, so picking Anton painted the system sans-serif and looked, to the
 * owner, exactly like a font that simply did not work.
 */
export async function ensureFontLoaded(family) {
  if (!family || loadedFaces.has(family)) return;
  loadedFaces.add(family);
  try {
    const css = await (await fetch(`/api/fonts/${encodeURIComponent(family)}/css`)).text();
    if (css.trim()) {
      const el = document.createElement('style');
      el.dataset.font = family;
      el.textContent = css;
      document.head.appendChild(el);
    }
    if (document.fonts?.load) await document.fonts.load(`16px "${family}"`);
  } catch { /* the picker already marks unready families; a failed fetch just leaves it unloaded */ }
}

export async function loadFontFamilies() {
  let families = [];
  try { families = (await api.get('/fonts/families')).families || []; } catch { return; }
  state.fontFamilies = families;
  const label = (f) => `${SOURCE_MARK[f.source] || ''}${f.family}${f.ready ? '' : m(' — chưa tải')}`;

  const bf = $('#cfgBrandFont');
  if (bf) {
    const cur = bf.value;
    bf.innerHTML = `<option value="">${m('— Theo style guide —')}</option>`
      + families.filter((f) => f.ready).map((f) => `<option value="${esc(f.family)}">${esc(label(f))}</option>`).join('');
    bf.value = cur;
  }
  const sf = $('#cfgSubFont');
  if (sf) {
    // option value = BARE family name: one canonical form feeds both the harness caption stack
    // and the ASS FontName, which must be a plain family or libass cannot match it.
    const cur = sf.value;
    sf.innerHTML = families.map((f) =>
      `<option value="${esc(f.family)}" style="font-family:'${esc(f.family)}',sans-serif"${f.ready ? '' : ' data-unready="1"'}>${esc(label(f))}</option>`).join('');
    sf.value = cur || 'Be Vietnam Pro';
    syncSubWeights();
  }
  // Only the picked family is fetched now; the whole picker's typefaces (up to twelve base64
  // stylesheets, half a megabyte) load when the subtitle group is actually opened.
  await ensureFontLoaded($('#cfgSubFont')?.value);
  updateSubPreview();
}

/** Draw every option in its own typeface — choosing a font you cannot see is guesswork. */
export function loadPickerFonts() {
  const families = state.fontFamilies || [];
  return Promise.all(families.filter((f) => f.ready && f.source !== 'system').slice(0, 12).map((f) => ensureFontLoaded(f.family)));
}

/** Fetch a catalogue family the owner picked but has not got yet. */
export async function downloadFont(family) {
  const r = await api.post(`/fonts/${encodeURIComponent(family)}/download`, {});
  loadedFaces.delete(family);
  await loadFontFamilies();
  await ensureFontLoaded(family);
  return r;
}
