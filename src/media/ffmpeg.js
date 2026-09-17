// ffmpeg facade — the spawn wrapper, probes, image checks, audio synthesis and footage processing live under ./ffmpeg; every existing import path keeps working.
export { detachFilterGraph, ffmpeg, ffmpegAss, hasDrawtext } from './ffmpeg/run.js';
export { probeDuration, probeFrameRate, probeImageSize } from './ffmpeg/probe.js';
export { verifyTransparentBg, makeGradientImage } from './ffmpeg/images.js';
export { measureLoudness, normalizeVoice, makeSilence, makeWhoosh, makeSfxBed, makeAmbientBed } from './ffmpeg/audio.js';
export { detectSubjectX, reframeOffsetX, detectSilence, silenceKeepRanges, removeSilence, zoomFocus, zoomFilter, compositeColorkey } from './ffmpeg/footage.js';
