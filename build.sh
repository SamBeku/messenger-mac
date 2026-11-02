#!/bin/bash
# Builds build/Messenger.app. Run `./build.sh install` to also copy it into /Applications.
set -euo pipefail
cd "$(dirname "$0")"

APP="build/Messenger.app"
ARCH="$(uname -m)"

# App icon (generated once, then reused).
if [ ! -f build/AppIcon.icns ]; then
  echo "→ Drawing app icon"
  mkdir -p build/icon.iconset
  swiftc -O Tools/make-icon.swift -o build/make-icon
  build/make-icon build/icon-1024.png
  for s in 16 32 128 256 512; do
    sips -z $s $s build/icon-1024.png --out "build/icon.iconset/icon_${s}x${s}.png" >/dev/null
    sips -z $((s * 2)) $((s * 2)) build/icon-1024.png --out "build/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns build/icon.iconset -o build/AppIcon.icns
fi

echo "→ Compiling"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -swift-version 5 -target "$ARCH-apple-macos14.0" \
  Sources/*.swift -o "$APP/Contents/MacOS/Messenger"
cp Info.plist "$APP/Contents/Info.plist"
cp Sources/bridge.js "$APP/Contents/Resources/bridge.js"
cp build/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
xattr -cr "$APP" # Finder metadata on copied files breaks code signing
codesign --force --sign - "$APP"
echo "✓ Built $APP"

if [ "${1:-}" = "install" ]; then
  osascript -e 'quit app "Messenger"' 2>/dev/null || true
  while pgrep -xq Messenger; do sleep 0.2; done
  rm -rf /Applications/Messenger.app
  ditto "$APP" /Applications/Messenger.app
  echo "✓ Installed to /Applications/Messenger.app"
  open /Applications/Messenger.app
fi
