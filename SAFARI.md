# WP Detective for Safari

The extension ships a companion Xcode project under `safari/` that wraps the
same extension files in a macOS host app — Safari's own packaging model.
The runtime (background, content scripts, popup) is identical to the
Chrome build.

## Build & install (developer)

Requirements: macOS with Xcode installed (not just Command Line Tools).

```
git clone git@github.com:fabiankaegy/wp-detective.git
cd wp-detective
npm install
npm run build:safari
open 'safari/WP Detective/WP Detective.xcodeproj'
```

In Xcode:

1. Select the `WP Detective` scheme (the default).
2. Press **Run** (⌘R). Xcode builds the container app, installs it, and
   launches it once.
3. Quit the launched app.
4. Open Safari → Settings → Extensions → enable **WP Detective**.

If Safari refuses to enable an unsigned extension, turn on:
**Safari → Develop → Allow Unsigned Extensions**. This setting resets each
time Safari quits — unsigned dev builds need to be re-enabled per session.

## Keeping the Safari build in sync

The Xcode project references files it has its own copies of under
`safari/WP Detective/WP Detective Extension/Resources/`. `npm run build:safari`
rebuilds the popup bundle and rsyncs every shipping runtime file into that
folder, so re-run it whenever `manifest.json`, `background.js`, `content.js`,
`lib/*`, `popup/popup.html`, or any icon changes.

## Distribution

For personal use, a Debug build signed with an ad-hoc identity (as
produced by a plain ⌘R in Xcode) is enough.

Shipping to other Macs requires joining the Apple Developer Program (\$99/yr),
setting `DEVELOPMENT_TEAM` in the project settings, and either:

- notarizing a Release build of `WP Detective.app` for direct distribution, or
- submitting to the Mac App Store (App Store Connect → new Mac app →
  attach the Safari extension target).

## Re-generating the Xcode project

The project under `safari/` was produced by:

```
xcrun safari-web-extension-converter ./path-to-runtime-files \
  --project-location ./safari \
  --app-name "WP Detective" \
  --bundle-identifier com.fabiankaegy.wp-detective \
  --swift --macos-only --copy-resources --no-open
```

Re-run it only when changing major project structure (e.g. adding iOS,
renaming the app). One fix-up is needed after regeneration: the converter
auto-capitalizes the app's product name into the app bundle ID
(`com.fabiankaegy.WP-Detective`), which then doesn't share a prefix with
the extension's bundle ID and fails the embedded-binary check. Run:

```
sed -i '' \
  's|PRODUCT_BUNDLE_IDENTIFIER = "com.fabiankaegy.WP-Detective";|PRODUCT_BUNDLE_IDENTIFIER = "com.fabiankaegy.wp-detective";|g' \
  'safari/WP Detective/WP Detective.xcodeproj/project.pbxproj'
```
