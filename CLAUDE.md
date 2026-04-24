# WP Detective

Browser extension (MV3, Chrome + Safari) that detects WordPress sites
and surfaces quick admin shortcuts from the toolbar.

## Architecture

- `manifest.json` — MV3, two content script entries (document_start for
  pre-paint admin bar hiding, document_idle for detection + toggle)
- `lib/detect.js` — pure WordPress detection, framework-free, testable
- `lib/rest.js` — REST API helpers + two-tier edit URL resolution
  (sync from body classes, async fallback via wp/v2 endpoints)
- `lib/host.js` — hosting provider detection (DOM asset scan + HTTP
  header inspection), local dev detection, host display names
- `lib/early.js` — hides admin bar before paint when pref is set
  (skips wp-admin pages)
- `content.js` — runs detection, reports to background, manages admin
  bar visibility, handles popup REST resolution and host header requests
- `background.js` — per-origin cache, icon state, cache purging, host
  caching with 90-day refresh interval
- `popup/` — toolbar popup UI (vanilla JS, Fraunces + Geist)
- `test/smoke.js` — jsdom-based smoke tests for the pure modules

## Key design decisions

- Edit URL resolution is two-tier: sync from body classes first
  (WP emits both slug and numeric ID classes — most cases resolve
  without a network call), REST fallback only when body classes lack
  the ID
- REST fetches run from content script, not popup — same-origin means
  cookies flow and CORS is a non-issue
- Admin bar hiding runs at two layers: CSS injection at document_start
  to prevent flash, class removal at document_idle for state tracking
- Admin bar hiding is skipped on wp-admin pages — the toolbar is
  integral to the admin UI
- Caching is per-origin with 1-week freshness, 4-week purge for
  unvisited sites; host data uses a 90-day refresh interval since
  hosting providers rarely change
- Host detection is two-tier: DOM asset URL scan (sync, free) first,
  then a same-origin HEAD request for response headers only when DOM
  didn't find a host and cache is stale
- View/Preview URLs on admin edit pages come from the admin bar's
  own links (#wp-admin-bar-view for published, #wp-admin-bar-preview
  for drafts) — WordPress handles all the URL construction and nonce
  generation, so it works for all post types including CPTs
- Logged-in detection has two fallbacks beyond body classes: the
  wordpress_logged_in cookie and the wp-settings cookie (always set
  for logged-in users, never httpOnly)

## Dev workflow

- Iterate in Chrome first (chrome://extensions → load unpacked) — 10x
  faster reload than Safari
- Run `cd test && npm test` before reloading the extension when
  changing detect.js, rest.js, or host.js
- Only run the Safari converter (xcrun safari-web-extension-converter)
  once the Chrome version works end to end

## Coding conventions

- Vanilla JS, no build step, no framework
- IIFE modules attach to globalThis.WPDetect / WPRest / WPHost
  namespace (content scripts can't use ES module imports)
- Message types are uppercase constants (WP_DETECTION,
  GET_LIVE_DETECTION, APPLY_ADMIN_BAR_PREF, RESOLVE_EDIT_URL_REST,
  RESOLVE_HOST_HEADERS, GET_CACHED_DETECTION)
- Prefer paraphrased comments that explain *why*, not *what*
- Error swallowing with `catch (_)` is fine for extension-context
  invalidation and expected tab-gone cases; real errors should log

## What's next (roadmap)

- Keyboard shortcut for "edit this page" (MV3 commands API)
- "Copy shortlink" / "Copy edit link" menu items
- Block-theme template edit URLs for home + archive pages via
  /wp-json/wp/v2/templates
- Multisite / Network admin awareness
- Safari packaging (run xcrun safari-web-extension-converter, open
  generated Xcode project, enable unsigned extensions in Safari
  Develop menu)
- Final icon artwork (currently placeholder W-on-circle PNGs)
