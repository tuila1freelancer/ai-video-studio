// Article fetcher facade — the extractor, the image picker, the AI refinement pass and the fetch live under ./fetchlink; every existing import path keeps working.
export { decodeEntities, charsetOf, stripChrome, pickMain, dropTrailingOverlay, articleBlocks, extractBlocks, joinCapped } from './fetchlink/extract.js';
export { widestSrc, imageCandidates, extractImages } from './fetchlink/images.js';
export { parseRanges, refineArticle } from './fetchlink/refine.js';
export { metaContent, fetchLink } from './fetchlink/fetch.js';
