// Bundled by bundle-root.test.js through the real release options, then run from a fake payload
// layout. Prints what paths.js decided, so the test can compare bundle against repo.
import { DIRS, PATHS, ROOT } from '../../src/config/paths.js';

console.log(JSON.stringify({ ROOT, data: DIRS.data, projects: DIRS.projects, ffmpegAss: PATHS.ffmpegAss }));
