#!/bin/bash
# Install Folio into this user's application menu. No dev server.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="${FOLIO_HOME:-$HOME/.local/share/folio}"
export PATH="/usr/bin:/bin:$PATH"

npm run studio:build -- --base ./
python3 mac/icon.py

remembered=""
if [[ -f "$DEST/last-open.json" ]]; then
  remembered="$(mktemp)"
  cp "$DEST/last-open.json" "$remembered"
fi
rm -rf "$DEST"
mkdir -p "$DEST/studio" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/256x256/apps"
if [[ -n "$remembered" ]]; then
  cp "$remembered" "$DEST/last-open.json"
  rm -f "$remembered"
fi
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
