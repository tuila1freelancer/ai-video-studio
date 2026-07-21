// Boot: wire every module, then load data and restore the last session.
import { api } from './api.js';
import { state } from './state.js';
import { initModals } from './ui/modals.js';
import { initNav, switchPage, renderDeps } from './views/nav.js';
import { initHome } from './views/home.js';
import { initStudio, initWs, loadProjects, openProject } from './views/studio.js';
import { initScenes, renderScenes } from './views/scenes.js';
import { buildPipeSteps } from './views/progress.js';
import { initConfig, buildSubColors, updateEstimate, loadStyles, loadTemplates, loadBgmOptions, loadChannelPresets, loadSubtitlePresets, loadFontFamilies } from './views/config.js';
import { initLibrary } from './views/library.js';
import { initBrandGen } from './views/brandgen.js';
import { initEditVideo } from './views/editvideo.js';
import { initPlayer } from './views/player.js';
import { initSettings, loadVoices, loadSettings } from './features/settings.js';
import { initVoicePicker } from './features/voicepicker.js';
import { initChannels, loadChannels } from './features/channels.js';
import { initBrandKit, refreshBrandSummary } from './features/brandkit.js';
import { initSrt } from './features/srt.js';
import { initBatch } from './features/batch.js';
import { initAutopilot } from './features/autopilot.js';
import { initJournal } from './features/journal.js';
import { initTasks } from './features/tasks.js';
import { initSceneStudio } from './features/scene-studio.js';
import { initTemplateGallery } from './features/template-gallery.js';
import { initPalette } from './ui/palette.js';

init();

async function init() {
  initNav();
  initHome();
  initStudio();
  initScenes();
  initConfig();
  initBrandKit();
  initModals();
  initLibrary();
  initBrandGen();
  initEditVideo();
  initPlayer();
  initSettings();
  initVoicePicker();
  initChannels();
  initSrt();
  initBatch();
  initAutopilot();
  initJournal();
  initTasks();
  initSceneStudio();
  initTemplateGallery();
  initPalette();
  buildSubColors();
  buildPipeSteps();
  initWs();
  try {
    const health = await api.get('/health');
    renderDeps(health.deps);
  } catch {}
  // Startup fast-path: paint the shell with critical data first…
  await Promise.all([loadChannels(), loadProjects(), loadStyles(), loadTemplates()]);
  await loadChannelPresets();
  refreshBrandSummary();
  updateEstimate();
  // Resume-on-reload: reopen the project that is (or was) running so progress is never lost from view.
  const busy = state.projects.find((p) => p.status === 'running')
    || (localStorage.lastProjectId && state.projects.find((p) => p.id === localStorage.lastProjectId && ['paused', 'error'].includes(p.status)));
  if (busy) { switchPage('studio'); openProject(busy.id); }
  // …then load the heavy catalogs when the main thread is idle (voice list ~322 items, BGM, subtitle presets).
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 50));
  idle(async () => {
    await Promise.all([loadVoices(), loadBgmOptions(), loadSubtitlePresets(), loadFontFamilies()]);
    await loadSettings(); // needs state.providers from loadVoices
    if (state.current) renderScenes(); // re-render once catalogs are in (template names etc.)
  });
}
