#!/usr/bin/env bash
#
# ProBruno — builds this Bruno checkout and installs it on macOS as a separate
# app, leaving an official Bruno install and its data alone.
#
# Run it from inside a Bruno checkout, on the branch you want to build:
#   ./scripts/probruno.sh
#
# Requires macOS on Apple Silicon and Node 22.x (.nvmrc pins v22.12.0).
#
# Short flags are deliberate here: macOS ships BSD rm/cp/find/sed, which have no
# long option forms.
#
# Override anything via the environment, e.g.
#   INSTALL_DIR=/Applications ASSUME_YES=1 ./scripts/probruno.sh

set -euo pipefail

PRODUCT_NAME="${PRODUCT_NAME:-ProBruno}"
APP_ID="${APP_ID:-com.usebruno.app.probruno}"
DATA_NAME="${DATA_NAME:-probruno}"
ASSUME_YES="${ASSUME_YES:-0}"

say()  { printf '\n=== %s\n' "$1"; }
die()  { printf 'error: %s\n' "$1" >&2; exit 1; }

# ---------- preflight ----------
say 'Preflight'
[ "$(uname -s)" = 'Darwin' ] || die 'this script is for macOS'
[ "$(uname -m)" = 'arm64' ]  || die "expected Apple Silicon, found $(uname -m)"
command -v git  >/dev/null || die 'git not found'
command -v node >/dev/null || die 'node not found — install Node 22 (nvm install 22.12.0)'
command -v npm  >/dev/null || die 'npm not found'
case "$(node --version)" in
  v22.*) ;;
  *) die "Node $(node --version) found, need v22.x (.nvmrc pins v22.12.0)" ;;
esac
printf 'node %s, npm %s\n' "$(node --version)" "$(npm --version)"

# ---------- source ----------
# Build whatever checkout this script sits in, on whatever branch is current.
# Nothing is fetched, checked out or reset: switching branches stays your call.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$REPO_DIR" ] || die 'run this from inside a Bruno checkout'
cd "$REPO_DIR"
say 'Source'
printf 'repo    %s\nbranch  %s\ncommit  %s\n' \
  "$REPO_DIR" \
  "$(git rev-parse --abbrev-ref HEAD)" \
  "$(git log -1 --format='%h %ad %s' --date=short)"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  printf 'note    working tree has uncommitted changes; they will be built too\n'
fi

# ---------- dependencies ----------
say 'Installing dependencies (a few minutes)'
npm ci || { printf 'npm ci failed, retrying as documented in contributing.md\n'; npm i --legacy-peer-deps; }

# ---------- packages ----------
say 'Building workspace packages'
for target in build:graphql-docs build:bruno-query build:bruno-common \
              build:bruno-converters build:bruno-requests build:schema-types \
              build:bruno-filestore; do
  printf '  %s\n' "$target"
  npm run "$target"
done
printf '  sandbox:bundle-libraries\n'
npm run sandbox:bundle-libraries --workspace=packages/bruno-js

say 'Building the web bundle'
npm run build:web

# ---------- stage the renderer ----------
# What scripts/build-electron.sh does, in BSD-sed form.
say 'Staging the renderer into bruno-electron/web'
cd packages/bruno-electron
rm -rf out web
mkdir web
cp -r ../bruno-app/dist/* web/
sed -i '' -e 's@/static/@static/@g' web/*.html
sed -i '' -e 's@/static/font@../../static/font@g' web/static/css/*.css
find web -name '*.map' -type f -delete

# ---------- package ----------
# -c.mac.identity=null       : unsigned. The config hardcodes Bruno's own
#                              certificate, which we don't have. With no signing,
#                              electron-builder also skips the notarize hook.
# -c.appId / -c.productName  : separate app, so the official Bruno is untouched.
# -c.extraMetadata.name      : rewrites name in the packaged package.json, which
#                              is what Electron derives its userData directory
#                              from — keeps this build's data separate.
say "Packaging $PRODUCT_NAME (dmg, arm64, unsigned)"
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --arm64 \
  --config electron-builder-config.js \
  -c.mac.identity=null \
  -c.appId="$APP_ID" \
  -c.productName="$PRODUCT_NAME" \
  -c.extraMetadata.name="$DATA_NAME"

DMG="$(ls -t out/*.dmg | head -1)"
[ -f "$DMG" ] || die 'no dmg produced'
printf 'built %s (%s)\n' "$DMG" "$(du -h "$DMG" | cut -f1)"

# ---------- install ----------
# ~/Applications by default: writing to /Applications needs admin rights, which a
# managed Mac may withhold. Set INSTALL_DIR=/Applications for the system-wide
# location; sudo is used only when the directory is not writable.
INSTALL_DIR="${INSTALL_DIR:-$HOME/Applications}"
TARGET="${INSTALL_DIR}/${PRODUCT_NAME}.app"

mkdir -p "$INSTALL_DIR" 2>/dev/null || true
if [ -w "$INSTALL_DIR" ]; then
  AS_ROOT=''
else
  [ -d "$INSTALL_DIR" ] || die "cannot create $INSTALL_DIR"
  AS_ROOT='sudo'
  printf '\n%s is not writable — the install step will ask for your password.\n' "$INSTALL_DIR"
fi

if [ -d "$TARGET" ] && [ "$ASSUME_YES" != '1' ]; then
  printf '\n%s already exists. Replace it? [y/N] ' "$TARGET"
  read -r reply
  case "$reply" in
    y|Y) ;;
    *) printf 'Left it alone. The dmg is at %s/%s\n' "$PWD" "$DMG"; exit 0 ;;
  esac
fi

say "Installing to $TARGET"
MOUNT="$(mktemp -d)"
cleanup() {
  hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
  rmdir "$MOUNT" 2>/dev/null || true
}
trap cleanup EXIT
hdiutil attach "$DMG" -mountpoint "$MOUNT" -nobrowse -quiet
$AS_ROOT rm -rf "$TARGET"
$AS_ROOT ditto "$MOUNT/${PRODUCT_NAME}.app" "$TARGET"
cleanup
trap - EXIT

# Unsigned builds are quarantined on first open; clear it so the app launches.
$AS_ROOT xattr -dr com.apple.quarantine "$TARGET"

say 'Done'
printf 'Installed  %s\n' "$TARGET"
printf 'Launch     open "%s"\n' "$TARGET"
printf 'Data dir   ~/Library/Application Support/%s  (official Bruno keeps its own)\n' "$DATA_NAME"
printf 'Uninstall  %s rm -rf "%s" && rm -rf ~/Library/Application\\ Support/%s\n' "$AS_ROOT" "$TARGET" "$DATA_NAME"
