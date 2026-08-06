// A channel remembers how its subtitles look — including while they are switched off.
//
// Two complaints behind this, both from the owner (2026-08-06):
//   "chỉnh phụ đề của kênh nào thì phải lưu lại để dùng tự động cho các lần sau"
//   "bật/tắt phụ đề thì config lúc bật trước đó vẫn phải còn khi bật lại"
//
// The first was simply not implemented: the subtitle style lived in the project being edited and
// the only way to carry it forward was a save icon buried in the channel dialog that wrote the
// entire panel over the channel. The second is what makes an autosave dangerous rather than
// helpful — a control that has not loaded yet reads as empty, and an autosave that trusts it will
// erase the very thing it was meant to protect.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as DB from '../src/db/index.js';
import { saveSubtitleDefaults, pickSubtitleConfig } from '../src/api/services/subtitle-defaults.js';
import { resolveProjectConfig } from '../src/core/config.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const LOOK = {
  enableSubtitles: true, subtitlePreset: 'bold-impact', subtitleFont: 'Anton', subtitleFontSize: 96,
  subtitleColor: '#00E5FF', subtitleTextCase: 'uppercase', subtitleMode: 'karaoke',
  subtitleChunk: 'words', subtitleWordsPerCue: 5, subtitlePosition: { preset: 'mid', marginV: 0.12 },
};
let n = 0;
const channel = () => DB.createChannel({ name: `sub-${++n}`, config: { aspectRatio: '9:16' } });

test('editing a channel’s subtitles saves them for that channel', () => {
  const ch = channel();
  const { saved } = saveSubtitleDefaults(ch.id, LOOK);
  assert.deepEqual(saved.sort(), Object.keys(LOOK).sort());
  const cfg = DB.getChannel(ch.id).config;
  for (const [k, v] of Object.entries(LOOK)) assert.deepEqual(cfg[k], v, k);
  assert.equal(cfg.aspectRatio, '9:16', 'and nothing else on the channel was touched');
  // …which is what "dùng tự động cho các lần sau" means: the next video starts with it.
  assert.equal(resolveProjectConfig({ channel: DB.getChannel(ch.id) }).subtitleFont, 'Anton');
});

test('it is a narrow door — the panel cannot write anything else through it', () => {
  const ch = channel();
  saveSubtitleDefaults(ch.id, {
    ...LOOK, aspectRatio: '16:9', fps: 60, brandKit: { channelName: 'HACKED' }, ai: { llm: { apiKey: 'x' } },
  });
  const cfg = DB.getChannel(ch.id).config;
  assert.equal(cfg.aspectRatio, '9:16');
  assert.equal(cfg.fps, undefined);
  assert.equal(cfg.brandKit, undefined);
  assert.equal(cfg.ai, undefined);
});

test('an unloaded control never erases a saved setting', () => {
  // The font picker is empty until the family registry arrives over the network, and the autosave
  // fires on every change. Storing that empty string is how a channel's subtitle look disappears.
  const ch = channel();
  saveSubtitleDefaults(ch.id, LOOK);
  saveSubtitleDefaults(ch.id, { subtitleFont: '', subtitleFontSize: 0, subtitleColor: '', subtitlePosition: null });
  const cfg = DB.getChannel(ch.id).config;
  assert.equal(cfg.subtitleFont, 'Anton');
  assert.equal(cfg.subtitleFontSize, 96);
  assert.equal(cfg.subtitleColor, '#00E5FF');
  assert.deepEqual(cfg.subtitlePosition, { preset: 'mid', marginV: 0.12 });
});

test('turning subtitles off keeps the look, and turning them on brings it back', () => {
  const ch = channel();
  saveSubtitleDefaults(ch.id, LOOK);
  saveSubtitleDefaults(ch.id, { ...LOOK, enableSubtitles: false });
  const off = DB.getChannel(ch.id).config;
  assert.equal(off.enableSubtitles, false);
  assert.equal(off.subtitleFont, 'Anton', 'the style survives being switched off');
  assert.equal(off.subtitlePreset, 'bold-impact');
  saveSubtitleDefaults(ch.id, { enableSubtitles: true });
  const on = DB.getChannel(ch.id).config;
  assert.equal(on.enableSubtitles, true);
  for (const k of ['subtitleFont', 'subtitleFontSize', 'subtitleColor', 'subtitleTextCase', 'subtitlePreset']) {
    assert.deepEqual(on[k], LOOK[k], `${k} came back`);
  }
});

test('the two meaningful empties are choices and they persist', () => {
  // '' on the preset is "Tuỳ biến tay"; '' on the case is "theo bộ mẫu". Dropping them as blanks
  // would make custom subtitles impossible to keep — the card would show selected and the video
  // would come out styled by the preset the owner had just left.
  const ch = channel();
  saveSubtitleDefaults(ch.id, LOOK);
  saveSubtitleDefaults(ch.id, { subtitlePreset: '', subtitleTextCase: '' });
  const cfg = DB.getChannel(ch.id).config;
  assert.equal(cfg.subtitlePreset, '');
  assert.equal(cfg.subtitleTextCase, '');
  assert.deepEqual(pickSubtitleConfig({ subtitlePreset: '', subtitleFont: '' }), { subtitlePreset: '' });
});

test('the default preset cannot shadow what was just saved', () => {
  // resolveProjectConfig layers the channel's DEFAULT preset OVER channel.config, so a preset
  // saved from the whole panel months ago carries a subtitle look that wins. The setting would
  // appear to save and then not apply — the worst of both.
  const ch = channel();
  const def = DB.createPreset({ channelId: ch.id, name: 'Mặc định', config: { subtitleFont: 'Lexend', fps: 24 }, isDefault: true });
  const other = DB.createPreset({ channelId: ch.id, name: 'Kiểu khác', config: { subtitleFont: 'Oswald' } });
  const { presetUpdated } = { presetUpdated: !!saveSubtitleDefaults(ch.id, LOOK).preset };
  assert.equal(presetUpdated, true);
  assert.equal(DB.getPreset(def.id).config.subtitleFont, 'Anton');
  assert.equal(DB.getPreset(def.id).config.fps, 24, 'the rest of the preset is left alone');
  assert.equal(DB.getPreset(other.id).config.subtitleFont, 'Oswald', 'a preset the owner picks by hand is not rewritten');
  assert.equal(resolveProjectConfig({
    channel: DB.getChannel(ch.id), preset: DB.defaultPresetFor(ch.id),
  }).subtitleFont, 'Anton');
});

test('the panel saves as it is edited, and cannot save while it is being populated', () => {
  const cfg = src('../public/js/views/config.js');
  assert.match(cfg, /saveSubtitleDefaults\(\)/, 'the controls call it');
  assert.match(cfg, /if \(applying \|\| !state\.activeChannel\) return;/,
    'populating the panel is not the owner editing it');
  assert.match(cfg, /applying = true;\s*\n\s*try \{ applyConfigInner\(cfg\); \} finally \{ applying = false; \}/);
  // the on/off switch is deliberately in the autosave list — "tắt phụ đề" is a decision too
  assert.match(cfg, /'#cfgSub', '#cfgSubFont', '#cfgSubSize', '#cfgSubCase', '#cfgSubPos', '#cfgSubMode', '#cfgSubChunk', '#cfgSubWords'\]\s*\n\s*\.forEach\(\(id\) => \$\(id\)\?\.addEventListener\('change', \(\) => saveSubtitleDefaults\(\)\)\);/);
  // and the panel never sends an empty font, which is the client half of the same guard
  assert.match(cfg, /subtitleFont: \$\('#cfgSubFont'\)\.value \|\| undefined,/);
  assert.match(cfg, /subtitlePreset: state\.subPreset \|\| '',/);
});

test('the panel starts on the channel it is pointed at', () => {
  // Nothing loaded the active channel's config at boot, and "video mới" left the previous
  // project's settings in the form — so a saved channel look was invisible until the owner
  // switched channels and back, and one edit later the panel's version won.
  const st = src('../public/js/state.js');
  assert.match(st, /export function channelDefaults\(\)/);
  assert.match(st, /\(state\.presets \|\| \[\]\)\.find\(\(p\) => p\.is_default\)/, 'same layering as the server');
  assert.match(src('../public/js/main.js'), /applyConfig\(channelDefaults\(\)\);/);
  assert.match(src('../public/js/views/studio.js'), /applyConfig\(channelDefaults\(\)\);/);
  const ch = src('../public/js/features/channels.js');
  assert.match(ch, /await loadChannelPresets\(\);\s*\n\s*applyConfig\(channelDefaults\(\)\);/);
  assert.ok(!/if \(ch && ch\.config && Object\.keys\(ch\.config\)\.length\) applyConfig/.test(ch),
    'unconditional: a channel with no config resets the panel instead of inheriting the last one');
});

test('every subtitle restore in applyConfig is unconditional', () => {
  // A guarded restore leaves the PREVIOUS channel's value in the control on a channel that never
  // set one — and gatherConfig then pins it onto the new channel's video. This is the same trap
  // already fixed for #cfgLang and #cfgSubCase; these are the rest of the group.
  const cfg = src('../public/js/views/config.js');
  for (const line of [
    /\$\('#cfgSubSize'\)\.value = cfg\.subtitleFontSize \|\| 80;/,
    /\$\('#cfgSubCase'\)\.value = cfg\.subtitleTextCase \|\| '';/,
    /state\.subColor = cfg\.subtitleColor \|\| '#F7B500';/,
    /\$\('#cfgSubPos'\)\.value = cfg\.subtitlePosition\?\.preset \|\| 'bot';/,
  ]) assert.match(cfg, line);
  assert.ok(!/if \(cfg\.subtitleFontSize\)|if \(cfg\.subtitleColor\)|if \(cfg\.subtitlePosition\?\.preset\)/.test(cfg));
});
