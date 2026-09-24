// Serving the interface itself: the assembled document, the hashed release assets, the fonts.
//
// Lifted out of server.js verbatim when boot() outgrew its line budget — the wiring is one
// coherent job and reads better named than inlined among licence recovery and shutdown.
import express from 'express';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { assembleIndex } from '../util/html-include.js';
import { uiSessionToken, wantsUiSession } from '../ops/ui-session.js';

/** A release build names every script and stylesheet by its content hash. */
const HASHED = /-[A-Z0-9]{8}\.(?:js|css)$/;

/**
 * Mount the SPA. Call AFTER the API, so /api wins.
 * @param {import('express').Express} app @param {string} publicDir
 */
export function mountStaticSite(app, publicDir) {
  // Font filenames encode family+weight+subset, so /fonts can be cached immutable — a manifest
  // change produces new URLs.
  app.use('/fonts', express.static(join(publicDir, 'fonts'), { maxAge: '365d', immutable: true, fallthrough: false }));
  // The document is assembled from its partials once, served from memory, always revalidated
  // (the release build hashes everything it references). The partials themselves are not a page.
  const indexHtml = assembleIndex(publicDir);
  const indexEtag = `"${createHash('sha1').update(indexHtml).digest('hex').slice(0, 16)}"`;
  const sendIndex = (req, res) => {
    // The launcher opens the window at /?uikey=<nonce>. That one request becomes a session cookie
    // and a clean URL, so the nonce never sits in history and the window can talk to a server that
    // asks every other caller for a token.
    if (wantsUiSession(req)) {
      res.cookie('avs_token', uiSessionToken(), { httpOnly: true, sameSite: 'strict', maxAge: 31536000000 });
      return res.redirect(302, '/');
    }
    res.set('Cache-Control', 'no-cache');
    res.set('ETag', indexEtag);
    if (req.headers['if-none-match'] === indexEtag) return res.status(304).end();
    res.type('html').send(indexHtml);
  };
  app.get(['/', '/index.html'], sendIndex);
  app.use('/partials', (req, res) => res.status(404).end());
  app.use(express.static(publicDir, {
    index: false,
    setHeaders: (res, path) => { if (HASHED.test(path)) res.set('Cache-Control', 'public, max-age=31536000, immutable'); },
  }));
  // Deep links get the document; a missing asset gets a 404, not 120 KB of HTML parsed as script.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    if (/\.[a-z0-9]+$/i.test(req.path)) return res.status(404).end();
    sendIndex(req, res);
  });
}
