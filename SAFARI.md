# WordPress Browser Extension — Safari

The extension ships a companion Xcode project under `safari/` that wraps the
same extension files in a macOS host app — Safari's own packaging model.
The runtime (background, content scripts, popup) is identical to the
Chrome build.

> The Xcode project files and folder names still use the original
> `WP Detective` literal, pending an in-Xcode "Rename Project" pass and a
> bundle-ID change coordinated with whoever owns the Apple developer account.
> The user-facing display name (manifest, Settings → Extensions) is already
> the new "WordPress Browser Extension."

## Build & install (developer)

Requirements: macOS with Xcode installed (not just Command Line Tools).

```
git clone https://github.com/jakemgold/wordpress-browser-extension.git
cd wordpress-browser-extension
npm install
npm run build:safari
open 'safari/WP Detective/WP Detective.xcodeproj'
```

In Xcode:

1. Select the `WP Detective` scheme (the default).
2. Press **Run** (⌘R). Xcode builds the container app, installs it, and
   launches it once.
3. Quit the launched app.
4. Open Safari → Settings → Extensions → enable **WordPress Browser Extension**.

If Safari refuses to enable an unsigned extension, turn on:
**Safari → Develop → Allow Unsigned Extensions**. This setting resets each
time Safari quits — unsigned dev builds need to be re-enabled per session.

## Keeping the Safari build in sync

The Xcode project references files it has its own copies of under
`safari/WP Detective/WP Detective Extension/Resources/`. `npm run build:safari`
rebuilds the popup bundle and rsyncs every shipping runtime file into that
folder, so re-run it whenever `manifest.json`, `background.js`, `content.js`,
`lib/*`, `popup/popup.html`, or any icon changes.

## Known issues

### Popup leaves a gap at the bottom after collapsing an accordion

When an accordion (Site Information, Developer Tools, +New) expands the
popup tall enough to scroll, then collapses, Safari leaves the popup
window at the previous (taller) size — the now-shorter content sits at
the top with empty space below, and there's nothing scrollable to
re-anchor on. Closing and reopening the popup restores the correct size.

Cause: Safari Web Extension popup windows appear to size against the
WebContent process's first-paint measurement and don't re-measure when
the body shrinks. `App.js` pins `html` and `body` heights to the React
root's measured height to nudge a re-measure, which mitigates but does
not fully resolve it. Chrome auto-sizes correctly and the same code is
a no-op there.

Workarounds tried that didn't resolve it: ResizeObserver on body /
html, scrollTop reset, explicit min/max height, transform-trick reflow.

If the bug becomes a release blocker, the fallback is to pin the popup
to a fixed height (e.g. 600px) so it never grows or shrinks.

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
