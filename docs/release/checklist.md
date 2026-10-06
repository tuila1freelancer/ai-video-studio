# Release checklist

What has to be true before a build is published. Two lists, because the two platforms are not
equally proven: macOS is built, audited and run here on every release; **Windows is built and
audited here but has never been run on Windows**, and the second list is the part somebody with a
Windows machine has to do before that installer is handed to anyone.

Run the gates from the repository root with the vendored runtime (`vendor/node/bin/node`), never the
machine's default Node — `better-sqlite3` is compiled against Node 22 and a Node 24 will refuse to
load it.

---

## 1. Before either build

```bash
vendor/node/bin/node --test --test-timeout=120000 "tests/*.test.js"
npm run lint
npm run test:smoke
```

- [ ] Suite green, lint clean.
- [ ] `git status` clean, and the version in `package.json` is the one being released.
- [ ] Interface and manual translated: `node scripts/i18n-extract.mjs`, `node
      scripts/i18n-extract-ui-msgs.mjs` and `node scripts/i18n-extract-guide.mjs` report nothing new;
      `node scripts/audit-i18n.mjs` exits 0. Changed a Vietnamese string in place? Its key is stale
      in twelve catalogues — drop that key from each and run `node scripts/build-locales.mjs`
      (add `--guide` for the manual). Skipping this is silent: the app simply shows Vietnamese to
      everyone else.
- [ ] Manual read on screen, not only extracted: open **Hướng dẫn**, check the chapters that changed,
      the `go` buttons and the `code` blocks.
## 2. macOS

```bash
npm run shell:build:dist
vendor/node/bin/node scripts/audit-release.mjs
```

- [ ] Audit green, including *Agent Kit present in the payload* and *kit holds no 64-hex key*.
- [ ] Open the built `.app`: the window appears with no key, no account and no sign-in.
- [ ] Close the window: the app stays in the menu bar, and `curl $(cat ~/Library/Application\
      Support/AI\ Video\ Studio/server.url)/api/health` still answers.
- [ ] Launch it a second time: no second server, the running window comes forward.
- [ ] AI Setting → Agent: turn it on, mint a token, paste the printed command into a terminal, and
      confirm the kit answers (`avs health`). Then revoke and confirm the next call is refused.
- [ ] Spending caps: set one, save, reopen, still there.
- [ ] Menu bar → Thoát hẳn actually ends the process.
- [ ] `npm run release -- --version <v>` (builds, audits, signs, notarises, staples). The sourcemap
      must land in `dist/private/`, never in the payload.

## 3. Windows — NOT YET VERIFIED ON WINDOWS

Built and audited on macOS; everything below is unproven until someone runs it on a real Windows
machine. Do not publish the installer before this list is done.

```bash
npm run win:build
vendor/node/bin/node scripts/audit-windows.mjs
```

- [ ] Audit green, including the Agent Kit checks and *better_sqlite3.node is a Windows binary*.

On a real Windows machine (Windows 10 or 11, x64):

- [ ] The installer runs and the app opens — this is the one that proves the Go launcher can decrypt
      the payload and that V8 accepts the bytecode compiled on a Mac. If it fails here, the bytecode
      or the ABI is wrong and nothing else on this list matters.
- [ ] `better-sqlite3` loads: the app reaches its own database (any screen that lists projects).
- [ ] Render one short video end to end: ffmpeg, Chrome and the subtitle burn all work.
- [ ] Chrome: the app finds an installed Google Chrome. Without one, thumbnails and subtitle
      measurement fail — confirm the dependency chip says so rather than failing silently.
- [ ] Voice: Edge TTS works (there is no `say` on Windows).
- [ ] A new channel's folder lands in `C:\Users\<user>\Videos\AI Video Studio\`.
- [ ] Close the window: the app stays in the system tray and the API still answers.
- [ ] Tray → Mở cùng máy: reboot, and the app is running.
- [ ] Agent: turn it on in AI Setting, mint a token, paste the printed command, and confirm the kit
      reaches the app — including that it found the app with no `--url`, on whatever port it bound.
- [ ] Data directory is `%APPDATA%\ai-video-studio\data` (that is where `server.url` must appear). If
      it is `%APPDATA%\AI Video Studio\data` instead, both are already in the kit's search list —
      note which one it was, and fix the manual to match.

## 4. After publishing

- [ ] Download the published artefact and open it — not the one in `dist/`. It must reach its own
      screen with nothing asked of the person opening it.
- [ ] Update the release notes.
