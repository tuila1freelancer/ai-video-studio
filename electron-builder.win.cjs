// electron-builder config for the PROTECTED Windows build. Used only by scripts/build-windows.mjs
// (`electron-builder --win -c electron-builder.win.cjs`); package.json `build` stays the macOS/dev
// config so `electron:mac`/`electron:dev` are untouched.
//
// The difference from the old, leaky Windows build: src/** and node_modules/** never enter the asar.
// The server ships as encrypted V8 bytecode in an extraResources payload (app-payload/), launched by
// a compiled key-holder (avs-launcher.exe) running the vendored node.exe (node-win/). The asar ends
// up holding only the thin Electron main process (shell/electron/main.cjs + package.json).
//
// scripts/build-windows.mjs assembles shell/build/win-payload, vendor/node-win and
// shell/build/avs-launcher.exe BEFORE electron-builder runs; the extraResources `from` paths point
// at those.
const { cpSync, existsSync } = require('node:fs');
const { join } = require('node:path');

module.exports = {
  appId: 'com.tuila1freelancer.aivideostudio',
  productName: 'AI Video Studio',
  // electron-builder deliberately strips node_modules from an extraResources directory copy, so the
  // server's production deps — including the win-ABI better_sqlite3.node — never make it in that way.
  // Copy them in after packing but BEFORE the NSIS installer is built, so the installer includes them.
  afterPack: async (context) => {
    if (context.electronPlatformName !== 'win32') return;
    const src = join(__dirname, 'shell', 'build', 'win-payload', 'node_modules');
    const dest = join(context.appOutDir, 'resources', 'app-payload', 'node_modules');
    if (!existsSync(src)) throw new Error(`afterPack: thiếu ${src} — build-windows.mjs phải dựng payload trước`);
    cpSync(src, dest, { recursive: true });
  },
  directories: {
    output: 'dist/electron',
    buildResources: 'shell',
  },
  // Only the Electron main process goes in the asar. It requires nothing but `electron` and node
  // built-ins, so no node_modules is needed here — and src/public ship (minified/bytecode) in the
  // payload, never as readable source.
  files: [
    'shell/electron/**/*',
    'package.json',
    '!node_modules/**/*',
    '!src/**/*',
    '!public/**/*',
    '!**/*.map',
    '!**/*.md',
  ],
  asar: true,
  // Do NOT let @electron/rebuild touch the checkout's better-sqlite3 (it would swap it to the
  // Electron ABI and break the macOS app). The server's own node_modules — with the correct
  // Node-win ABI binary — is staged into the payload by build-windows.mjs instead.
  npmRebuild: false,
  // Runtime hardening. onlyLoadAppFromAsar + asar-integrity mean a modified asar refuses to boot;
  // the run-as-node / inspect / NODE_OPTIONS fuses shut the doors that would let someone turn the
  // shipped Electron binary back into a plain, debuggable Node. The Windows server child is the
  // vendored node.exe (not this binary), so disabling run-as-node here costs the app nothing.
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: '${productName}-${version}-win-${arch}-setup.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    shortcutName: 'AI Video Studio',
  },
  extraResources: [
    { from: 'shell/build/win-payload', to: 'app-payload' },
    { from: 'vendor/node-win', to: 'node-win' },
    { from: 'shell/build/avs-launcher.exe', to: 'avs-launcher.exe' },
  ],
};
