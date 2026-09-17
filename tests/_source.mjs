// Read a source file for the tests that assert on its TEXT.
//
// Those tests pin behaviour they cannot reach any other way — that a failed upload raises a toast,
// that the join announces how long it took. The sentence is the evidence, so the assertion quotes
// it. Wrapping that sentence for translation does not change the behaviour, but it does change the
// text, which broke ten of these at once the first time it happened.
//
// So the wrappers come off before matching: `m('…')` and `tp\`…\`` read as the plain string and the
// plain template they stand for, and an assertion goes on quoting the sentence the owner sees.
//
// The second thing that breaks these tests is a file being SPLIT. `RELOCATED` maps a path that no
// longer holds everything it used to onto the files it became, in their original top-to-bottom
// order, and `sourceOf()` hands back their concatenation — so an anchor written against the old
// file keeps matching, and an order-dependent assertion (`indexOf(a) < indexOf(b)`) keeps its
// meaning as long as both markers moved into the same file. Splitting a file is one entry here.
import { readFileSync } from 'node:fs';
import { assembleIndex } from '../src/util/html-include.js';

const ROOT = new URL('../', import.meta.url);

/** Old path → the files it was split into, in the order the old file had them. */
export const RELOCATED = {
  'src/api/routes.js': [
    'src/api/routes.js',
    'src/api/routers/license.js', 'src/api/routers/settings-providers.js', 'src/api/routers/styles.js',
    'src/api/routers/channels.js', 'src/api/routers/projects.js', 'src/api/routers/project-exports.js',
    'src/api/routers/pipeline.js', 'src/api/routers/journal-usage.js', 'src/api/routers/assistant-calendar.js',
    'src/api/routers/publish.js', 'src/api/routers/project-outputs.js', 'src/api/routers/jobs.js',
    'src/api/routers/scene-studio.js', 'src/api/routers/scenes.js', 'src/api/routers/research.js',
    'src/api/routers/library-fonts.js', 'src/api/routers/brands.js', 'src/api/routers/files-media.js',
    'src/api/routers/edit-video.js', 'src/api/helpers.js', 'src/core/llm-accounts.js',
    'src/api/services/project-files.js', 'src/api/services/contact-sheet.js', 'src/api/services/folder-picker.js',
  ],
  'src/providers/llm.js': [
    'src/providers/llm.js', 'src/providers/llm/transport.js', 'src/providers/llm/json.js', 'src/providers/llm/script.js',
    'src/providers/llm/budget.js', 'src/providers/llm/generate.js', 'src/providers/llm/metadata.js',
  ],
  'src/pipeline/stages/finalize.js': [
    'src/pipeline/stages/finalize.js', 'src/pipeline/finalize/clips.js', 'src/pipeline/finalize/dressing.js',
    'src/pipeline/finalize/sound.js', 'src/pipeline/finalize/captions.js', 'src/pipeline/finalize/concat.js',
    'src/pipeline/finalize/master.js', 'src/pipeline/finalize/qc.js', 'src/pipeline/finalize/thumbnail.js',
  ],
  'src/pipeline/render.js': [
    'src/pipeline/render.js', 'src/pipeline/render/transitions.js', 'src/pipeline/render/captions.js',
    'src/pipeline/render/graph.js', 'src/pipeline/render/encode.js',
  ],
  'src/content/master-script.js': [
    'src/content/master-script.js', 'src/content/master-script/plan.js', 'src/content/master-script/validate.js',
    'src/content/master-script/repair.js', 'src/content/master-script/prompt.js', 'src/content/master-script/shape.js',
    'src/content/master-script/outline.js', 'src/content/master-script/generate.js',
  ],
  'src/animation/harness.js': [
    'src/animation/harness.js', 'src/animation/harness/fonts.js', 'src/animation/harness/runtime-core.js',
    'src/animation/harness/runtime-typeset.js', 'src/animation/harness/runtime-seek.js', 'src/animation/harness/runtime.js',
    'src/animation/harness/page.js',
  ],
  'src/providers/fetchlink.js': [
    'src/providers/fetchlink.js', 'src/providers/fetchlink/extract.js', 'src/providers/fetchlink/images.js',
    'src/providers/fetchlink/refine.js', 'src/providers/fetchlink/fetch.js',
  ],
  'src/media/ffmpeg.js': [
    'src/media/ffmpeg.js', 'src/media/ffmpeg/run.js', 'src/media/ffmpeg/probe.js', 'src/media/ffmpeg/images.js',
    'src/media/ffmpeg/audio.js', 'src/media/ffmpeg/footage.js',
  ],
  'src/hyperframe/prompt.js': [
    'src/hyperframe/prompt.js', 'src/hyperframe/prompt/system.js', 'src/hyperframe/prompt/blocks.js',
    'src/hyperframe/prompt/layout.js', 'src/hyperframe/prompt/animation.js', 'src/hyperframe/prompt/build.js',
  ],
  'public/js/views/config.js': [
    'public/js/views/config.js', 'public/js/views/config/fonts.js', 'public/js/views/config/subtitle-studio.js',
    'public/js/views/config/form.js', 'public/js/views/config/frame-preview.js', 'public/js/views/config/hf-style.js',
    'public/js/views/config/catalogs.js', 'public/js/views/config/groups.js', 'public/js/views/config/presets.js',
  ],
  'public/js/views/studio.js': [
    'public/js/views/studio.js', 'public/js/views/studio/ws.js', 'public/js/views/studio/wiring.js',
    'public/js/views/studio/projects.js', 'public/js/views/studio/actions.js', 'public/js/views/studio/project-view.js',
    'public/js/views/studio/outputs.js', 'public/js/views/studio/source.js',
  ],
  'public/js/features/settings.js': [
    'public/js/features/settings.js', 'public/js/features/settings/index.js', 'public/js/features/settings/publish.js',
    'public/js/features/settings/llm.js', 'public/js/features/settings/tts.js',
  ],
  'public/js/features/brandkit.js': [
    'public/js/features/brandkit.js', 'public/js/features/brandkit/draft.js', 'public/js/features/brandkit/stage.js',
    'public/js/features/brandkit/index.js',
  ],
};

/** `m('x')` → `'x'`, `tp\`x\`` → `` `x` ``. Nothing else is touched. */
export function unwrapI18n(code) {
  return String(code)
    .replace(/\bm\(\s*'((?:\\.|[^'\\])*)'\s*\)/g, "'$1'")
    .replace(/\bm\(\s*"((?:\\.|[^"\\])*)"\s*\)/g, '"$1"')
    .replace(/(?<![\w.$])tp`/g, '`');
}

const readRoot = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');

/** The source at `rel` (repo-root relative), following `RELOCATED`, with the i18n wrappers removed. */
export function sourceOf(rel) {
  if (rel === 'public/index.html') return indexHtml(); // the shell alone is 174 lines of markers
  const parts = RELOCATED[rel] || [rel];
  return unwrapI18n(parts.map(readRoot).join('\n'));
}

/** The interface markup as the browser receives it: the shell with every partial expanded. */
export function indexHtml() {
  return assembleIndex(new URL('public/', ROOT).pathname);
}

/** The source of `path`, relative to the CALLER, with the i18n wrappers removed. */
export function source(path, base) {
  return unwrapI18n(readFileSync(new URL(path, base), 'utf8'));
}
