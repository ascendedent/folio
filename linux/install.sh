#!/bin/bash
# Install Folio into this user's application menu. No dev server.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="${FOLIO_HOME:-$HOME/.local/share/folio}"
export PATH="/usr/bin:/bin:$PATH"

npm run studio:build -- --base ./
python3 mac/icon.py

# WebKit keeps the autosaved draft and settings in $DEST too (databases/,
# localstorage/), beside last-open.json. Replace only the app's own files.
rm -rf "$DEST/studio"
mkdir -p "$DEST/studio" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/256x256/apps"
cp linux/folio.py "$DEST/folio.py"
cp studio/favicon.png "$DEST/favicon.png"
cp -R dist-studio/. "$DEST/studio/"
chmod +x "$DEST/folio.py"

python3 - << PY
import gi
gi.require_version("GdkPixbuf", "2.0")
from gi.repository import GdkPixbuf
from pathlib import Path
buf = GdkPixbuf.Pixbuf.new_from_file("mac/icon.png")
small = buf.scale_simple(256, 256, GdkPixbuf.InterpType.BILINEAR)
out = Path.home() / ".local/share/icons/hicolor/256x256/apps/folio.png"
out.parent.mkdir(parents=True, exist_ok=True)
small.savev(str(out), "png", [], [])
PY

sed "s|__FOLIO_DIR__|$DEST|g" linux/folio.desktop > "$HOME/.local/share/applications/folio.desktop"
chmod +x "$HOME/.local/share/applications/folio.desktop"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
echo "INSTALLED $DEST"
