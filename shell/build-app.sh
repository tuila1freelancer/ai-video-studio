#!/bin/bash
# Build the native macOS shell into "AI Video Studio.app".
#
# Two modes:
#   (default)  DEV — a thin launcher that runs `node src/server.js` out of THIS repo. Instant to
#              build, and the only thing that has to change when JS changes is the running process.
#   --dist     DISTRIBUTABLE — everything the app needs is copied inside the bundle: the Node
#              runtime, production node_modules, the vendored ffmpeg. A dev bundle bakes absolute
#              paths into the owner's checkout, so handing one to a customer ships them an app
#              that points at a folder they do not have.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="dev"
[ "$1" = "--dist" ] && MODE="dist"

AVS_PORT="${AVS_PORT:-8123}"
# Overridable so a release candidate can be built and smoke-tested without deleting the copy the
# owner is using — the first thing this script does is `rm -rf` the target.
APP="${AVS_APP_PATH:-AI Video Studio.app}"
VERSION="$(node -p "require('$ROOT/package.json').version")"

echo "mode:    $MODE"
echo "version: $VERSION"
echo "root:    $ROOT"
echo "port:    $AVS_PORT"

mkdir -p shell/build

if [ "$MODE" = "dev" ]; then
  # Resolve node@22 (keg-only homebrew, bundled, or system)
  NODE_PATH="$(/usr/bin/which node 2>/dev/null || true)"
  for c in /opt/homebrew/opt/node@22/bin/node /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$c" ]; then NODE_PATH="$c"; break; fi
  done
  echo "node:    $NODE_PATH"
  cat > shell/build/Config.swift <<EOF
import Foundation
let NODE_PATH = "$NODE_PATH"
let PROJECT_ROOT = "$ROOT"
let AVS_PORT = "$AVS_PORT"
let EXTRA_ENV: [String: String] = [:]
EOF
else
  # A portable runtime is not optional: the Homebrew \`node\` is an 84 KB stub linked against a
  # dozen dylibs under /opt/homebrew, so a bundle carrying it runs here and crashes everywhere.
  if [ ! -x "$ROOT/vendor/node/bin/node" ]; then
    echo "✖ thiếu runtime Node di động cho bản phát hành."
    echo "  Chạy: npm run node:fetch"
    exit 1
  fi
  echo "node:    vendor/node/bin/node ($("$ROOT/vendor/node/bin/node" -v))"
  cat > shell/build/Config.swift <<EOF
import Foundation
// Everything is relative to the bundle: a distributed app knows nothing about the machine it was
// built on, and its data lives where macOS expects an app's data to live.
private let RES = Bundle.main.resourcePath ?? "."
let NODE_PATH = RES + "/node/bin/node"
let PROJECT_ROOT = RES + "/app"
let AVS_PORT = "$AVS_PORT"
let EXTRA_ENV: [String: String] = [
  "AVS_DIST": "1",
  "AVS_DATA_DIR": (NSHomeDirectory() as NSString).appendingPathComponent("Library/Application Support/AI Video Studio"),
]
EOF
fi

echo "compiling launcher…"
xcrun swiftc -O shell/main.swift shell/build/Config.swift -o shell/build/launcher \
  -framework Cocoa -framework WebKit

echo "assembling bundle…"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp shell/build/launcher "$APP/Contents/MacOS/AI Video Studio"
chmod +x "$APP/Contents/MacOS/AI Video Studio"

# our own icon (npm run icon:build regenerates from shell/icon.svg)
if [ -f shell/AppIcon.icns ]; then
  cp shell/AppIcon.icns "$APP/Contents/Resources/icon.icns"
else
  echo "⚠ shell/AppIcon.icns chưa có — chạy: npm run icon:build"
fi

# Strip everything a running app never reads. Two reasons, one command: 519 dependency READMEs
# are 30 MB of download, and together they are a printed inventory of the stack for anyone opening
# the bundle. Licence texts stay — MIT and friends require them to travel with the code.
scrub_payload() {
  local dir="$1"
  find "$dir" \( -name '.DS_Store' -o -name '*.map' -o -name '*.ts' -o -name '*.flow' \
    -o -name '*.test.js' -o -name '*.spec.js' -o -name '.npmignore' -o -name '.travis.yml' \
    -o -name '.eslintrc*' -o -name '.editorconfig' \) -type f -delete 2>/dev/null || true
  # Markdown, except anything that is a licence.
  find "$dir" -type f \( -iname '*.md' -o -iname '*.markdown' \) \
    ! -iname '*licen[cs]e*' ! -iname 'copying*' ! -iname 'notice*' -delete 2>/dev/null || true
  find "$dir" -type d \( -name 'test' -o -name 'tests' -o -name '__tests__' \
    -o -name 'example' -o -name 'examples' \) -prune -exec rm -rf {} + 2>/dev/null || true
}

if [ "$MODE" = "dist" ]; then
  echo "copying runtime + app payload…"
  APPDIR="$APP/Contents/Resources/app"
  mkdir -p "$APPDIR"
  cp -R vendor/node "$APP/Contents/Resources/node"
  cp -R src public package.json package-lock.json "$APPDIR/"

  # Production dependencies only, installed into a staging tree so the dev node_modules (with its
  # test tooling) never leaks into a customer's download.
  echo "installing production dependencies…"
  STAGE="$(mktemp -d)"
  cp package.json package-lock.json "$STAGE/"
  # The vendored runtime's own npm, so the install runs against the ABI the bundle will ship —
  # `better-sqlite3` is a native module and a mismatch here is a crash on the customer's machine.
  ( cd "$STAGE" && "$ROOT/vendor/node/bin/node" "$ROOT/vendor/node/lib/node_modules/npm/bin/npm-cli.js" ci --omit=dev --silent )
  cp -R "$STAGE/node_modules" "$APPDIR/node_modules"
  rm -rf "$STAGE"

  # vendor/, minus the parts a fresh install does not need:
  #   whisper — 547 MB of model, only used for transcribing imported footage. Downloaded on
  #             demand from Settings instead of doubling every customer's download.
  #   node    — already copied to Resources/node above.
  mkdir -p "$APPDIR/vendor"
  for v in ffmpeg gsap libs fonts; do
    [ -d "vendor/$v" ] && cp -R "vendor/$v" "$APPDIR/vendor/$v"
  done

  scrub_payload "$APPDIR"

  # Sanity: the payload has to be able to answer for itself.
  [ -f "$APPDIR/src/server.js" ] || { echo "✖ payload thiếu src/server.js"; exit 1; }
  [ -d "$APPDIR/node_modules/better-sqlite3" ] || { echo "✖ payload thiếu better-sqlite3"; exit 1; }
fi

cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>AI Video Studio</string>
  <key>CFBundleDisplayName</key><string>AI Video Studio</string>
  <key>CFBundleExecutable</key><string>AI Video Studio</string>
  <key>CFBundleIdentifier</key><string>com.aivideostudio.app</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>NSHumanReadableCopyright</key><string>© 2026 TuiLa1Freelancer — AI Video Studio</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
EOF

APP_ABS="$(cd "$(dirname "$APP")" && pwd)/$(basename "$APP")"
echo "✅ Built: $APP_ABS  (v$VERSION, $MODE)"
if [ "$MODE" = "dist" ]; then
  echo "   Kích thước: $(du -sh "$APP" | cut -f1)"
fi
echo "   Mở bằng: open \"$APP_ABS\""
