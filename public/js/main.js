// Boot: wire every module, then load data and restore the last session.
import { api } from './api.js';
import { state, channelDefaults } from './state.js';
import { initModals } from './ui/modals.js';
import { initNav, switchPage, renderDeps } from './views/nav.js';
import { initHome } from './views/home.js';
import { initStudio, initWs, loadProjects, openProject } from './views/studio.js';
import { initScenes, renderScenes } from './views/scenes.js';
import { buildPipeSteps } from './views/progress.js';
import { initConfig, applyConfig, buildSubColors, updateEstimate, loadBgmOptions, loadBrandFolders, loadMetadataStyles, loadChannelPresets, loadSubtitlePresets, loadFontFamilies } from './views/config.js';
import { initLibrary } from './views/library.js';
import { initBrandGen } from './views/brandgen.js';
import { initEditVideo } from './views/editvideo.js';
import { initDragDrop } from './features/dragdrop.js';
import { initPlayer } from './views/player.js';
import { initSettings, loadVoices, loadSettings } from './features/settings.js';
import { initVoicePicker } from './features/voicepicker.js';
import { initChannels, loadChannels } from './features/channels.js';
import { initBrandKit, refreshBrandSummary } from './features/brandkit.js';
import { initSrt } from './features/srt.js';
import { initChangePlan } from './features/changeplan.js';
import { initAftercare } from './features/aftercare.js';
import { initBatch } from './features/batch.js';
import { initAutopilot } from './features/autopilot.js';
import { initJournal } from './features/journal.js';
import { initTasks } from './features/tasks.js';
import { initSceneStudio } from './features/scene-studio.js';
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
  initChangePlan();
  initAftercare();
  initLibrary();
  initBrandGen();
  initEditVideo();
  initDragDrop();
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
  initPalette();
  buildSubColors();
  buildPipeSteps();
  initWs();
  try {
    const health = await api.get('/health');
    renderDeps(health.deps);
  } catch {}
  // Startup fast-path: paint the shell with critical data first…
  await Promise.all([loadChannels(), loadProjects()]);
  await loadChannelPresets();
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
  // …then load the heavy catalogs when the main thread is idle (voice list ~322 items, BGM, subtitle presets).
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 50));
  idle(async () => {
    await Promise.all([loadVoices(), loadBgmOptions(), loadBrandFolders(), loadMetadataStyles(), loadSubtitlePresets(), loadFontFamilies()]);
    await loadSettings(); // needs state.providers from loadVoices
    if (state.current) renderScenes(); // re-render once catalogs are in (template names etc.)
  });
}
