// Studio config panel facade — the form, the subtitle studio, the frame preview, the HyperFrame style picker, the catalogues, the group modals and the preset bars live under ./config; every existing import path keeps working.
export { ensureFontLoaded, loadFontFamilies, loadPickerFonts, downloadFont } from './config/fonts.js';
export { resRung, syncSubWeights, buildSubColors, updateSubLaneHint, gatherSubtitleConfig, saveSubtitleDefaults, updateSubPreview } from './config/subtitle-studio.js';
export { initConfig, syncSegs, gatherConfig, applyConfig, updateEstimate } from './config/form.js';
export { syncFramePreviewAvailability, refreshFramePreview } from './config/frame-preview.js';
export { loadBrandFolders, loadMetadataStyles, loadBgmOptions } from './config/catalogs.js';
export { updateCfgChips } from './config/groups.js';
export { loadChannelPresets, loadSubtitlePresets, renderSubPresetGrid } from './config/presets.js';
