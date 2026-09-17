// Server-side includes for the interface document.
//
// public/index.html is a shell of `<!--#include "partials/x.html" -->` markers; the partials are
// the pages and modals it used to carry inline (1,347 lines in one file). The document the
// browser receives is the expansion — assembled once at boot, byte-for-byte what the single
// file was — so nothing at runtime changed, only where an editor finds a screen's markup.
import { readFileSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';

const MARKER = /<!--#include "([^"]+)" -->/g;

/**
 * Expand every include marker in `html`, reading each partial with `read(relPath)`. Verbatim
 * substitution — no re-indentation, so the output does not depend on how a partial is nested;
 * the partial's final newline is dropped because the marker's own line break supplies it.
 * Partials may include partials; a path escaping the public root is refused.
 * @param {string} html
 * @param {(rel: string) => string} read
 * @param {number} [depth]
 */
export function expandIncludes(html, read, depth = 0) {
  // i18n-exempt: a broken include is a build defect, thrown at boot, never shown to the owner
  if (depth > 8) throw new Error('html-include: nesting too deep');
  return html.replace(MARKER, (m, rel) => {
    const clean = normalize(rel);
    if (clean.startsWith('..') || clean.includes(`${sep}..${sep}`) || clean.startsWith('/')) throw new Error(`html-include: refused ${rel}`);
    return expandIncludes(read(clean).replace(/\n$/, ''), read, depth + 1);
  });
}

/** The assembled document for a public dir on disk. */
export function assembleIndex(publicDir) {
  const read = (rel) => readFileSync(join(publicDir, rel), 'utf8');
  return expandIncludes(read('index.html'), read);
}
