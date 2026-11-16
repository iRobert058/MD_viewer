#!/bin/sh
# Copy the built app to /Applications and refresh Launch Services, so Finder
# and `open -a` use this build. Run after `npm run tauri build`.
set -eu
SRC="src-tauri/target/release/bundle/macos/Markdown Viewer.app"
DEST="/Applications/Markdown Viewer.app"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

[ -d "$SRC" ] || { echo "No build at $SRC; run: npm run tauri build" >&2; exit 1; }
osascript -e 'quit app "Markdown Viewer"' 2>/dev/null || true
rm -rf "$DEST"
ditto "$SRC" "$DEST"
"$LSREGISTER" -f "$DEST"
echo "Installed $DEST"
