#!/bin/bash
# Build and sign Folio.app on this Mac. Run from the repo root.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
IDENTITY="${FOLIO_SIGN_IDENTITY:-Apple Development: JOSEPH SOTO MAROTTA (25QQ6F7V8M)}"
APP="${FOLIO_APP_PATH:-$HOME/Applications/Folio.app}"

echo "node $(node -v)  npm $(npm -v)"
npm ci
npx vite build --base ./

python3 mac/icon.py
mkdir -p mac/Folio.iconset
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" mac/icon.png --out "mac/Folio.iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" mac/icon.png --out "mac/Folio.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns mac/Folio.iconset -o mac/AppIcon.icns

swiftc -O -parse-as-library -o mac/Folio mac/Folio.swift -framework Cocoa -framework WebKit

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp mac/Info.plist "$APP/Contents/Info.plist"
cp mac/Folio "$APP/Contents/MacOS/Folio"
cp mac/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
cp -R dist-studio "$APP/Contents/Resources/studio"
chmod +x "$APP/Contents/MacOS/Folio"

sign() {
  codesign --force --sign "$IDENTITY" --timestamp=none "$APP"
  codesign --verify --verbose=2 "$APP"
}

if ! sign; then
  # An SSH session cannot unlock the login keychain. The Mac desktop can.
  cat > /tmp/folio-sign.command << EOF
#!/bin/bash
codesign --force --sign "$IDENTITY" --timestamp=none "$APP" > /tmp/folio-codesign.txt 2>&1
echo EXIT:\$? >> /tmp/folio-codesign.txt
codesign --verify --verbose=2 "$APP" >> /tmp/folio-codesign.txt 2>&1
EOF
  chmod +x /tmp/folio-sign.command
  rm -f /tmp/folio-codesign.txt
  open /tmp/folio-sign.command
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if grep -q "valid on disk" /tmp/folio-codesign.txt 2>/dev/null; then
      break
    fi
    sleep 1
  done
  if ! grep -q "valid on disk" /tmp/folio-codesign.txt 2>/dev/null; then
    echo "Folio.app is built, but the desktop codesign did not finish." >&2
    cat /tmp/folio-codesign.txt >&2 || true
    exit 1
  fi
fi
echo "BUILT $APP"
