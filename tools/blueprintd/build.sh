#!/usr/bin/env bash
# Builds blueprintd.app into /Applications and installs a LaunchAgent so it
# starts at login. Run again after editing blueprintd.swift.
set -euo pipefail
cd "$(dirname "$0")"

APP=/Applications/blueprintd.app
mkdir -p "$APP/Contents/MacOS"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>nl.siem2l.blueprintd</string>
  <key>CFBundleName</key><string>blueprintd</string>
  <key>CFBundleExecutable</key><string>blueprintd</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST

swiftc -O -o "$APP/Contents/MacOS/blueprintd" blueprintd.swift
codesign --force --sign - "$APP"

AGENT="$HOME/Library/LaunchAgents/nl.siem2l.blueprintd.plist"
mkdir -p "$(dirname "$AGENT")"
cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>nl.siem2l.blueprintd</string>
  <key>ProgramArguments</key>
  <array><string>$APP/Contents/MacOS/blueprintd</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
PLIST

echo "built $APP and installed $AGENT"
