#!/usr/bin/env bash
# Download a GitHub build of Freely, sign it with the stable local identity so
# macOS keeps the system-audio permission across builds, and launch it.
#
# Usage: scripts/install-build.sh [run-id] [release|devshell]
#   run-id   GitHub Actions run to download (default: latest successful Build run)
#   variant  which artifact to install (default: release)
#
# One-time setup: create a self-signed code-signing certificate named
# "Freely Local Signing" in the login keychain (Keychain Access > Certificate
# Assistant > Create a Certificate, type "Code Signing").
set -euo pipefail

REPO="RohanJoshi28/freely"
IDENTITY="Freely Local Signing"
RUN_ID="${1:-}"
VARIANT="${2:-release}"

if [ "$VARIANT" = "devshell" ]; then
  ARTIFACT="freely-macos-aarch64-devshell"
  DEST="$HOME/coffee/build-dev"
  APP_NAME="Freely Dev.app"
else
  ARTIFACT="freely-macos-aarch64"
  DEST="$HOME/coffee/build"
  APP_NAME="Freely.app"
fi

if [ -z "$RUN_ID" ]; then
  RUN_ID=$(gh run list -R "$REPO" --workflow build.yml --status success --limit 1 --json databaseId --jq '.[0].databaseId')
fi

if ! security find-identity -v -p codesigning | grep -q "$IDENTITY"; then
  echo "Code-signing identity \"$IDENTITY\" not found in your keychain; see the setup note at the top of this script." >&2
  exit 1
fi

echo "Downloading run $RUN_ID ($ARTIFACT)..."
rm -rf "$DEST.new"
gh run download "$RUN_ID" -R "$REPO" -n "$ARTIFACT" -D "$DEST.new"

pkill -f "$APP_NAME/Contents/MacOS" 2>/dev/null || true
for _ in $(seq 1 10); do pgrep -f "$APP_NAME/Contents/MacOS" >/dev/null || break; sleep 1; done

rm -rf "$DEST"
mv "$DEST.new" "$DEST"
cd "$DEST/macos"
rm -rf "$APP_NAME"
tar -xzf "${APP_NAME}.tar.gz"
codesign --force --deep --sign "$IDENTITY" --timestamp=none "$APP_NAME"
codesign --verify --deep --strict "$APP_NAME"

open "$DEST/macos/$APP_NAME"
echo "Installed and launched $DEST/macos/$APP_NAME"
