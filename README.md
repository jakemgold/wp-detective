# WP Detective

A browser extension (Chrome, Safari coming soon) for WordPress developers
and site administrators. Instantly detect WordPress sites, jump to the
editor for any page, identify the hosting provider, toggle the admin bar,
and more — all from the toolbar.

## Features

- **WordPress detection** — Identifies WordPress sites via REST API
  discovery links, generator meta tags, asset paths, admin bar presence,
  and body classes. Confidence scoring with configurable threshold.

- **Edit any page** — One click (or `Alt+Shift+E`) to jump to the
  WordPress editor for the current page, post, category, tag, or author.
  Works for custom post types and custom taxonomies. Two-tier URL
  resolution: instant from body classes, REST API fallback when needed.

- **View/Preview from editor** — When editing a post in wp-admin, view
  the published page or preview a draft directly from the extension.
  Uses WordPress's own admin bar links, so it works for all post types
  including CPTs with custom query vars.

- **Hosting provider detection** — Identifies WP Engine, WordPress VIP,
  Pantheon, Kinsta, Flywheel, Cloudways, WordPress.com, Pressable, and
  local dev environments. Two-tier: DOM asset scan first (free), then a
  same-origin HEAD request for response headers. Cached for 90 days.

- **Admin bar management** — Hide or show the WordPress admin bar on the
  front end, per site. Two-layer approach prevents flash: CSS injection
  at `document_start`, class reconciliation at `document_idle`. Never
  touches the admin bar inside wp-admin.

- **Developer tools** (collapsible section):
  - **Preview mobile size** — Opens the current page in a phone-sized
    popup window (iPhone Pro dimensions) with minimal browser chrome.
  - **Attempt uncached view** — Reloads with a random query parameter
    to bypass CDN/edge caches.
  - **Clear site data** — Removes all cookies, localStorage, and
    sessionStorage for the site while preserving WordPress login cookies.
    Useful for testing forms, tracking scripts, and cache behavior.

- **Copy URL / Open in new tab** — Edit and view/preview actions include
  clipboard copy and new-tab buttons.

- **Sign-out safety** — Inline confirm pattern (no modal) that
  auto-dismisses after 10 seconds.

- **Logged-in detection** — Falls back to `wp-settings` cookies when the
  admin bar is hidden via WordPress profile settings.

## Installation

### Chrome (development)

1. Clone this repository
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the repository folder
5. Optionally configure the keyboard shortcut at `chrome://extensions/shortcuts`

### Safari (coming soon)

Run `xcrun safari-web-extension-converter` on the repository, open the
generated Xcode project, and enable unsigned extensions in Safari's
Develop menu.

## Keyboard shortcut

**`Alt+Shift+E`** (`Option+Shift+E` on Mac) — Edit the current page in
WordPress. Works on any detected WordPress page when logged in.
Customizable at `chrome://extensions/shortcuts`.

## Architecture

```
manifest.json          MV3 manifest, content script entries, commands
lib/detect.js          Pure WordPress detection (framework-free, testable)
lib/rest.js            REST API helpers, two-tier edit URL resolution
lib/host.js            Hosting provider detection (DOM + headers)
lib/early.js           Pre-paint admin bar hiding (document_start)
content.js             Detection orchestration, admin bar, messaging
background.js          Per-origin cache, icon state, keyboard shortcut
popup/                 Toolbar popup UI (vanilla JS, system fonts)
test/smoke.js          jsdom-based smoke tests
```

## Development

```bash
# Run tests (requires Node.js)
cd test && npm install && npm test

# Iterate in Chrome
# chrome://extensions → load unpacked → reload after changes
```

Vanilla JS throughout — no build step, no framework, no bundler.

## License

MIT
