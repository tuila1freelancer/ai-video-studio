// License: sign-in, activation, refresh and the update check — reachable while the app is locked.
import { activate, publicStatus, refreshNow } from '../../license/index.js';
import { adoptWithStoredSession, sessionAccount, signIn, signOut } from '../../license/auth.js';
import { checkUpdate, downloadUrl } from '../../license/update.js';

/** @param {import('express').Router} r */
export function mount(r) {
  // ---- license ----
  // Reachable while the app is locked: this is the door out of that state.
  r.get('/license/status', (req, res) => {
    res.json({ ...publicStatus(), account: sessionAccount() });
  });

  // Sign in with the store (Google) account; the licence follows automatically.
  r.post('/license/login', async (req, res) => {
    try {
      const result = await signIn();
      res.json({ ...publicStatus(), account: result.account, licenseFound: result.licenseFound });
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });

  // Re-adopt a licence with the stored session (after an admin device reset).
  r.post('/license/relink', async (req, res) => {
    try {
      const licenseFound = await adoptWithStoredSession();
      res.json({ ...publicStatus(), account: sessionAccount(), licenseFound });
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });

  r.post('/license/logout', (req, res) => {
    signOut();
    res.json({ ...publicStatus(), account: null });
  });

  r.post('/license/activate', async (req, res) => {
    try {
      await activate(req.body?.key);
      res.json(publicStatus());
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });

  r.post('/license/refresh', async (req, res) => {
    try {
      await refreshNow();
      res.json(publicStatus());
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });

  r.get('/license/update', async (req, res) => {
    try {
      res.json(await checkUpdate({ force: req.query.force === '1' }));
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });

  r.post('/license/update/download', async (req, res) => {
    try {
      res.json(await downloadUrl({ versionId: req.body?.versionId }));
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });
}
