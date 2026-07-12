#!/usr/bin/env bash
# ios-release.sh — build PBudget's iOS app and upload it to App Store Connect
# from an EPHEMERAL clone, leaving nothing on this Mac.
#
# Keep only this one file (e.g. ~/bin/ios-release.sh) plus ~/.pbudget-ios.env
# on your Mac. The repo is cloned to a temp dir and deleted on exit — no persistent
# checkout, no ios/ folder to manage. Since the app is a thin webview shell, app
# LOGIC ships via the normal server deploy; you only run this for a native/store change.
#
# One-time prereqs: Xcode + `xcode-select --install`, CocoaPods (`brew install cocoapods`),
# Node 18+ (nvm fine), and an App Store Connect API key — see ios-release.env.example.
# The App Store Connect app record for com.ppvnx.pbudget must exist once
# (App Store Connect → Apps → +). Automatic signing registers the bundle id itself.
set -euo pipefail

CONFIG="${PB_IOS_ENV:-$HOME/.pbudget-ios.env}"
[ -f "$CONFIG" ] || { echo "missing config: $CONFIG (copy scripts/ios-release.env.example)"; exit 1; }
# shellcheck disable=SC1090
source "$CONFIG"

: "${ASC_KEY_ID:?set in $CONFIG}" "${ASC_ISSUER_ID:?}" "${ASC_KEY_PATH:?}" "${ASC_TEAM_ID:?}" "${PB_REPO:?}"
[ -f "$ASC_KEY_PATH" ] || { echo "API key not found: $ASC_KEY_PATH"; exit 1; }
command -v xcodebuild >/dev/null || { echo "xcodebuild not found — install Xcode"; exit 1; }
command -v pod        >/dev/null || { echo "CocoaPods not found — brew install cocoapods"; exit 1; }

MARKETING_VERSION="${PB_MARKETING_VERSION:-1.0}"
EXPORT_METHOD="${PB_EXPORT_METHOD:-app-store-connect}"   # older Xcode (<15.3): app-store
BUILD_NUMBER="$(date +%s)"   # epoch secs: monotonic, unique, <2^32 — App Store accepts

WORK="$(mktemp -d)"
trap '[ -n "${PB_KEEP:-}" ] || rm -rf "$WORK"' EXIT
echo "▸ building in $WORK ${PB_KEEP:+(kept: PB_KEEP set)}"

git clone --depth 1 "$PB_REPO" "$WORK/src"
cd "$WORK/src"

echo "▸ installing deps + generating a fresh ios/ project"
npm ci
npx cap add ios                      # generates ios/ and runs pod install
npx capacitor-assets generate --ios  # brand icon + splash from resources/
npx cap sync ios

PLIST="ios/App/App/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $MARKETING_VERSION" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUMBER" "$PLIST"
echo "▸ version $MARKETING_VERSION ($BUILD_NUMBER)"

AUTH=( -authenticationKeyPath "$ASC_KEY_PATH"
       -authenticationKeyID "$ASC_KEY_ID"
       -authenticationKeyIssuerID "$ASC_ISSUER_ID"
       -allowProvisioningUpdates )

echo "▸ archiving (automatic signing via API key)"
xcodebuild -workspace ios/App/App.xcworkspace -scheme App \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$WORK/App.xcarchive" \
  DEVELOPMENT_TEAM="$ASC_TEAM_ID" \
  "${AUTH[@]}" \
  clean archive

cat > "$WORK/ExportOptions.plist" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>$EXPORT_METHOD</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$ASC_TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
</dict></plist>
PLISTEOF

echo "▸ exporting + uploading to App Store Connect"
xcodebuild -exportArchive \
  -archivePath "$WORK/App.xcarchive" \
  -exportPath "$WORK/export" \
  -exportOptionsPlist "$WORK/ExportOptions.plist" \
  "${AUTH[@]}"

echo "✓ uploaded build $BUILD_NUMBER — appears in App Store Connect → TestFlight in a few minutes"
