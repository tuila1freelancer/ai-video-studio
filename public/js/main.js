// Boot: wire every module, then load data and restore the last session.
import { accessGated, api } from './api.js';
import { initI18n } from './i18n.js';
import { state, channelDefaults } from './state.js';
import { initModals } from './ui/modals.js';
import { initNav, switchPage, renderDeps, registerPageHook } from './views/nav.js';
import { lazyClick } from './ui/lazy.js';
import { initHome } from './views/home.js';
import { initStudio, initWs, loadProjects, openProject } from './views/studio.js';
import { initScenes, renderScenes } from './views/scenes.js';
import { buildPipeSteps } from './views/progress.js';
import { initConfig, applyConfig, buildSubColors, updateEstimate, loadBgmOptions, loadBrandFolders, loadMetadataStyles, loadChannelPresets, loadSubtitlePresets, loadFontFamilies } from './views/config.js';
import { initLibrary } from './views/library.js';
import { initDragDrop } from './features/dragdrop.js';
import { initSettings, loadVoices, loadSettings } from './features/settings.js';
import { initChannels, loadChannels } from './features/channels.js';
import { initBrandKit, refreshBrandSummary } from './features/brandkit.js';
import { initChangePlan } from './features/changeplan.js';
import { initBatch } from './features/batch.js';
import { initJournal } from './features/journal.js';
import { initPalette } from './ui/palette.js';
import { bootLicense, initLicense } from './features/license.js';
import { initAccess } from './features/access.js';

init();

async function init() {
  // Before anything else. An unlicensed copy answers 403 to every other route, so loading
  // channels and projects first would just fill the console with failures behind a lock screen.
  initAccess(); // before anything fetches: a server-mode instance answers 401 until a token exists
  initLicense();
  if (!(await bootLicense())) return;
  initNav();
  // ONE round trip for everything the first paint needs. The catalogue for a translated
  // interface is fetched alongside it, on the language the last session left in localStorage;
  // if the server says otherwise the right one is fetched afterwards (a rare, one-time cost).
  let hint = null;
  try { hint = localStorage.uiLang || null; } catch { /* private window */ }
  const catalogueP = hint ? initI18n(hint).catch(() => null) : null;
  let boot = null;
  try { boot = await api.get('/boot'); } catch { /* offline or locked mid-way: the loaders below fetch on their own */ }
  // A server-mode instance with no token: the access screen is up and every further call would be
  // one more 401 behind it.
  if (accessGated()) return;
  if (boot) {
    api.seed('/settings', { settings: boot.settings, uiLang: boot.uiLang, agent: boot.agent, budget: boot.budget });
    api.seed('/health', { ok: true, deps: boot.deps });
  }
  // Paint the interface in the owner's language BEFORE any view patches a label, or the boot-time
  // label writes in studio.js and nav.js would overwrite the translation with Vietnamese.
  try {
    if (catalogueP && (!boot || boot.uiLang === hint)) await catalogueP;
    else await initI18n(boot?.uiLang);
  } catch { /* offline: the markup is Vietnamese already */ }
  initHome();
  initStudio();
  initScenes();
  initConfig();
  initBrandKit();
  initModals();
  initChangePlan();
  initLibrary();
  initDragDrop();
  initSettings();
  initChannels();
  initBatch();
  initJournal();
  initPalette();
  wireLazyModules();
  buildSubColors();
  buildPipeSteps();
  initWs();
  if (boot) renderDeps(boot.deps);
  else { try { renderDeps((await api.get('/health')).deps); } catch {} }
  // Startup fast-path: paint the shell with critical data first…
  await Promise.all([
    loadChannels(boot && { channels: boot.channels, active: boot.activeChannel }),
    loadProjects(boot && { projects: boot.projects }),
  ]);
  await loadChannelPresets(boot && boot.activeChannel === state.activeChannel ? { presets: boot.presets } : null);
  // Start the panel on the active channel's own settings. Nothing did this before: the form
  // opened on the markup defaults, so a channel that had chosen its subtitle font, aspect ratio
  // and voice showed none of them until the owner switched channels and back.
  applyConfig(channelDefaults());
  refreshBrandSummary();
  updateEstimate();
  // Resume-on-reload: reopen the project that is (or was) running so progress is never lost from view.
  const busy = state.projects.find((p) => p.status === 'running')
    || (localStorage.lastProjectId && state.projects.find((p) => p.id === localStorage.lastProjectId && ['paused', 'error'].includes(p.status)));
  if (busy) { switchPage('studio'); openProject(busy.id); }
  // Boot marks read by scripts/perf/boot-audit.mjs: shell painted with real data, then idle catalogs in.
  performance.mark('avs:boot-done');
  // …then load the heavy catalogs when the main thread is idle (voice list ~322 items, BGM, subtitle presets).
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 50));
  idle(async () => {
    await Promise.all([loadVoices(), loadBgmOptions(), loadBrandFolders(), loadMetadataStyles(), loadSubtitlePresets(), loadFontFamilies()]);
    await loadSettings(); // needs state.providers from loadVoices
    if (state.current) renderScenes(); // re-render once catalogs are in (template names etc.)
    performance.mark('avs:idle-done');
  });
}

/**
 * Screens and modals nobody has opened cost nothing until they do (~170 KB of the 415 KB
 * frontend). Pages load on first show; modal features load on their first trigger, wire their
 * own listeners, and the click is replayed. Everything a running video needs is still eager.
 */
function wireLazyModules() {
  registerPageHook('tutorials', () => import('./views/guide.js').then((m) => m.openGuide()));
  registerPageHook('brandgen', () => import('./views/brandgen.js').then((m) => m.openBrandGen()));
  registerPageHook('editvideo', () => import('./views/editvideo.js').then((m) => m.initEditVideo()));
  lazyClick('#heroAutopilot', () => import('./features/autopilot.js'), (m) => m.initAutopilot());
  lazyClick('#heroTasks', () => import('./features/tasks.js'), (m) => m.initTasks());
  lazyClick('#btnRoughCut', () => import('./views/player.js'), (m) => m.initPlayer());
  lazyClick('#btnOpenVoicePicker', () => import('./features/voicepicker.js'), (m) => {
    document.querySelector('#btnOpenVoicePicker')?.addEventListener('click', () => m.openVoicePicker());
  });
}
