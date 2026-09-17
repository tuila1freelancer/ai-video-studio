// Scene page builder facade — fonts, the in-page runtime and the page assembly live under
// ./harness; every existing import path keeps working.
export { vendoredFamilies, familiesIn, fontsCss } from './harness/fonts.js';
export { buildScenePage } from './harness/page.js';
