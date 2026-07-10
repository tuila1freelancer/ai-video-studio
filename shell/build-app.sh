#!/bin/bash
# Build the native macOS shell into "AI Video Studio.app".
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Resolve node@22 (keg-only homebrew, bundled, or system)
NODE_PATH="$(/usr/bin/which node 2>/dev/null || true)"
for c in /opt/homebrew/opt/node@22/bin/node /opt/homebrew/bin/node /usr/local/bin/node; do
  if [ -x "$c" ]; then NODE_PATH="$c"; break; fi
done
AVS_PORT="${AVS_PORT:-8123}"
APP="AI Video Studio.app"

echo "node:    $NODE_PATH"
echo "root:    $ROOT"
echo "port:    $AVS_PORT"

mkdir -p shell/build
cat > shell/build/Config.swift <<EOF
let NODE_PATH = "$NODE_PATH"
let PROJECT_ROOT = "$ROOT"
let AVS_PORT = "$AVS_PORT"
EOF

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

cat > "$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>AI Video Studio</string>
  <key>CFBundleDisplayName</key><string>AI Video Studio</string>
  <key>CFBundleExecutable</key><string>AI Video Studio</string>
  <key>CFBundleIdentifier</key><string>com.aivideostudio.app</string>
  <key>CFBundleVersion</key><string>1.0.0</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>NSHumanReadableCopyright</key><string>© 2026 TuiLa1Freelancer — AI Video Studio</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
EOF

echo "✅ Built: $ROOT/$APP"
echo "   Mở bằng: open \"$ROOT/$APP\""
