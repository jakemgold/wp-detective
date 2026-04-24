# WP Detective

A browser extension that detects WordPress sites and surfaces quick admin
shortcuts from the toolbar.

## Project layout

```
wp-detective/
  manifest.json          # MV3 manifest (Chrome + Safari compatible)
  background.js          # service worker: caching, icon state, purging
  content.js             # document_idle: detect, report, manage admin bar
  lib/
    early.js             # document_start: pre-paint admin bar hiding
    detect.js            # pure detection logic
    rest.js              # WordPress REST helpers + URL resolution
  popup/
    popup.html
    popup.js
    popup.css
  icons/                 # placeholder PNGs (replace with your own)
  test/
    smoke.js             # jsdom-based smoke tests
    package.json
```

## Dev loop

1. **Iterate in Chrome.** `chrome://extensions` → Developer mode → "Load
   unpacked" → select this folder. Reload the extension after each change
   and reload the target page.
2. **Test detection.** Open any WordPress site (wordpress.org, techcrunch.com,
   etc.). The toolbar icon turns blue when a WP site is detected. Click to
   open the popup.
3. **Package for Safari** when the extension works end-to-end:
   ```
   xcrun safari-web-extension-converter /path/to/wp-detective
   ```
   This generates an Xcode project. Build it, enable Safari's Develop menu →
   "Allow Unsigned Extensions", and the extension appears.

## Edit URL resolution

Resolving "edit this page" runs in two tiers:

1. **Sync (instant, no network).** The admin bar's own `#wp-admin-bar-edit`
   link is always preferred if present. Otherwise, body classes provide IDs
   directly for most cases — WordPress emits `postid-<id>`, `page-id-<id>`,
   `category-<id>`, `tag-<id>`, `term-<id>`, and `author-<id>` alongside
   the slug-based variants. The vast majority of pages resolve here.
2. **Async REST fallback.** When sync comes up empty but the page has
   enough context (taxonomy + slug, or author slug), the popup shows a
   spinner and asks the content script to call `wp/v2/<rest_base>?slug=...`
   against the page's origin. Same-origin means cookies flow and CORS
   doesn't apply, so authenticated content is visible.

Unresolvable cases (`home`, `archive`, block-theme templates) show a
disabled row with contextual copy — "Edit homepage (coming soon)" and
so on. These are future-work candidates; extend `resolveEditUrlSync`
and `resolveEditUrlAsync` in `lib/rest.js`.

## Testing

The pure modules (`lib/detect.js`, `lib/rest.js`) have no browser
dependencies and are validated under jsdom:

```
cd test
npm install    # installs jsdom, first time only
npm test       # runs the smoke suite
```

Each scenario constructs a DOM, loads the modules into that window, and
asserts against detection + URL output. Add a scenario for each new
signal or page type — see `test/smoke.js` for the pattern.

## Next steps

- Resolve block-theme template edit URLs for home + archive pages via
  `/wp-json/wp/v2/templates`. Requires auth but only shown to
  logged-in users anyway.
- Add keyboard shortcut to trigger "edit this page" without opening the
  popup.
- Multisite awareness — if `/wp-json/` returns network info, surface a
  "Network admin" shortcut for super-admins.
- "Copy shortlink" / "Copy edit link" menu items.
- Replace placeholder icons with final artwork.
