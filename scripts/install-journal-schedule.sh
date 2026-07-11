#!/bin/bash
# Install (or reinstall) the daily production-journal schedule as a macOS launchd agent.
# Runs scripts/journal.mjs every day at 21:30 local time; if the Mac was asleep at that
# moment, launchd fires the job on the next wake. Logs to data/journal.log.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.tuila1freelancer.avs-journal"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

mkdir -p "$HOME/Library/LaunchAgents" "$REPO/data"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>export PATH="/opt/homebrew/opt/node@22/bin:\$PATH"; cd "$REPO" && node scripts/journal.mjs >> data/journal.log 2>&1</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>21</integer><key>Minute</key><integer>30</integer></dict>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed: $LABEL (daily 21:30) → $PLIST"
launchctl list | grep "$LABEL" || true
