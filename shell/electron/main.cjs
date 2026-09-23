// Cross-platform shell: one window, one server, nothing else.
//
// .cjs, not .js: package.json declares "type": "module", so a .js entry loads as ESM and `require`
// would not exist. The Electron main process is the one place in this repo that is plainly easier
// as CommonJS.
//
// The macOS shell is 208 lines of Swift around a WKWebView. This is the same idea for every OS
// Electron runs on, and it is deliberately thin — the app IS the server plus a window, and every
// feature already lives on the server side.
//
// The server runs as a CHILD process rather than inside this one. That keeps the boundary the
// macOS build already has (a crash in a render cannot take the window down with it), and it means
// the server code is byte-identical on all three platforms.
const { app, BrowserWindow, Menu, Tray, shell, dialog, nativeImage } = require('electron');
const { fork, spawn } = require('node:child_process');
const { join } = require('node:path');
const { existsSync, mkdirSync } = require('node:fs');

const ROOT = join(__dirname, '..', '..');
const SERVER = join(ROOT, 'src', 'server.js');

let child = null;
let win = null;
let tray = null;

/**
 * Writable data lives beside the user's profile, never beside the executable. On Windows a
 * packaged app sits in Program Files, which is read-only for a normal account — the default
 * `<root>/data` would fail on the first write, and it would fail as a permissions error deep
 * inside SQLite rather than as anything a person could act on.
 */
function dataDir() {
  if (process.env.AVS_DATA_DIR) return process.env.AVS_DATA_DIR;
  if (!app.isPackaged) return join(ROOT, 'data'); // dev: keep using the repo's own data
  const dir = join(app.getPath('userData'), 'data');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Start the server and resolve with the URL it prints. Rejects if it dies or never speaks. */
function startServer() {
  return new Promise((resolve, reject) => {
    if (app.isPackaged && process.platform === 'win32') {
      // Windows release: the server ships as encrypted V8 bytecode, not readable source. A compiled
      // launcher (which alone carries the AES key) runs the vendored node.exe + loader.cjs and hands
      // the key down its stdin. This process must never see the key, so it is nowhere in here — the
      // launcher forwards the child's stdout, so "AVS_READY <url>" still arrives below unchanged.
      const launcher = join(process.resourcesPath, 'avs-launcher.exe');
      if (!existsSync(launcher)) return reject(new Error(`Không tìm thấy launcher: ${launcher}`));
      child = spawn(launcher, [], {
        cwd: join(process.resourcesPath, 'app-payload'),
        env: { ...process.env, AVS_DATA_DIR: dataDir() }, // launcher adds AVS_DIST=1; no key here
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } else {
      // Dev on any OS, and the packaged macOS electron build (which still bundles src): run the
      // server straight from source. ELECTRON_RUN_AS_NODE turns this same binary into a plain Node
      // runtime, so the packaged app carries no second copy of Node and the user installs nothing.
      if (!existsSync(SERVER)) return reject(new Error(`Không tìm thấy server: ${SERVER}`));
      child = fork(SERVER, [], {
        cwd: ROOT,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', AVS_DATA_DIR: dataDir() },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
    }

    let settled = false;
    const fail = (e) => { if (!settled) { settled = true; reject(e); } };

    child.stdout.on('data', (buf) => {
      const text = String(buf);
      process.stdout.write(text);
      const m = text.match(/AVS_READY\s+(https?:\/\/\S+)/);
      if (m && !settled) { settled = true; resolve(m[1]); }
    });
    child.stderr.on('data', (buf) => process.stderr.write(String(buf)));
    child.on('error', fail);
    child.on('exit', (code) => {
      child = null;
      fail(new Error(`Server thoát sớm (mã ${code})`));
      if (settled && !app.isQuitting) app.quit(); // the window is useless without it
    });

    // A server that never prints its URL is a hang, not a crash: say so instead of showing a
    // blank window forever.
    setTimeout(() => fail(new Error('Server không phản hồi sau 60 giây')), 60_000);
  });
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0b1220', // paint the app's own dark ground, not a white flash
    title: 'AI Video Studio',
    autoHideMenuBar: true,
    // devTools off once packaged: no inspector to dump the decrypted bytecode from memory (parity
    // with the Swift shell disabling developerExtrasEnabled in dist). On in dev.
    webPreferences: { nodeIntegration: false, contextIsolation: true, devTools: !app.isPackaged },
  });
  win.loadURL(url);
  // Anything aimed at another site opens in the real browser — this window is the app, not a tab.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!target.startsWith(url)) shell.openExternal(target);
    return { action: 'deny' };
  });
  // Closing the window hides it: the server keeps serving agents and finishing renders, and the tray
  // is what says so. Quitting for real goes through the tray or before-quit.
  win.on('close', (e) => {
    if (app.isQuitting) return;
    e.preventDefault();
    win.hide();
  });
  win.on('closed', () => { win = null; });
}

/** The tray is the only sign the app is still there once its window is hidden. */
function createTray() {
  const candidates = [
    join(process.resourcesPath || '', 'tray.png'),
    join(ROOT, 'shell', 'tray-32.png'),
  ];
  const found = candidates.find((p) => existsSync(p));
  const image = found ? nativeImage.createFromPath(found) : nativeImage.createEmpty();
  tray = new Tray(image);
  tray.setToolTip('AI Video Studio');
  const menu = Menu.buildFromTemplate([
    { label: 'Mở cửa sổ', click: () => showWindow() },
    {
      label: 'Mở cùng máy',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: 'Thoát hẳn', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => showWindow());
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// One copy per machine: two would mean two servers on one database. A second launch hands its
// argv to the copy already running, which raises its window — what the person meant by opening it.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

app.whenReady().then(async () => {
  try {
    const url = await startServer();
    createWindow(url);
    createTray();
  } catch (e) {
    dialog.showErrorBox('AI Video Studio không khởi động được', String(e.message || e));
    app.quit();
  }
  app.on('activate', () => showWindow());
});

// The server is a child, so it dies with us — but only if we actually ask. Without this it
// survives the window on Windows and holds the port against the next launch.
app.on('before-quit', () => { app.isQuitting = true; if (child) { child.kill(); child = null; } });
// Deliberately NOT app.quit(): the window is a view onto a server that agents may still be using.
// The tray's "Thoát hẳn" is the way out.
app.on('window-all-closed', () => {});
