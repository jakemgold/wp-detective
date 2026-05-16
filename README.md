# WordPress Browser Extension

> A browser extension that detects WordPress sites and puts admin shortcuts, hosting info, and developer tools in your toolbar. Chrome is the primary target; Safari is supported via a companion Xcode project.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

WordPress's admin bar is convenient — *Edit Post*, the jump-to-admin link, a few plugin add-ons — but it lives inside the website's viewport. That gets in the way when you're checking how a site behaves for a logged-out visitor, especially with sticky navigation, parallax, or designs that key off the full browser height (`100vh` layouts, raindrop scroll effects, anything immersive). The standard workaround — turning the admin bar off in your user profile — fixes the visual interference, but then quick access to wp-admin and content editing becomes a chore.

Plugins layer their own items onto the admin bar too. For most everyday work, *Edit this page*, *jump to admin*, and a handful of host or developer shortcuts cover 80% of what you reach for. This extension moves those out of the viewport entirely and into your browser toolbar — leaving the admin bar available when you do want it, out of the way when you don't. The audience is people who work across many WordPress sites: developers, agencies, plugin authors, site auditors.

A few extras follow naturally from sitting at the browser level instead of inside the site. It tells you whether the page you're on is powered by WordPress (and, where the signals allow, which managed host it's on), gives you a one-click log-in shortcut, and packages developer tools — mobile preview, cache bypass, cookies/site-data clear, block highlighter — that are genuinely cleaner as a browser overlay than as in-site UI.

<p align="center">
  <img src="screenshots/logged-in.png" width="380" alt="Logged in — Edit Case Study, host detected as WordPress VIP, admin bar toggle, +New / Site Information / Developer Tools accordions">
  <img src="screenshots/dev-tools.png" width="380" alt="Developer Tools expanded — Highlight Blocks toggle, Mobile Preview, Bypass Page Cache, Query Monitor, Clear Site Data">
</p>
<p align="center">
  <img src="screenshots/wp-admin.png" width="380" alt="wp-admin editor — View Post, Visit Site, WordPress Admin, Log Out">
  <img src="screenshots/logged-out.png" width="380" alt="Logged out on a WordPress site — version detected, Log In / Log In Return to Page actions">
</p>
<p align="center">
  <img src="screenshots/safari.png" width="600" alt="Safari companion build — same popup running natively in Safari on macOS">
</p>

## Status

**v0.8.x — pre-1.0, in production use.** The v1.0 milestone is initial official directory releases on the **Chrome Web Store** and **Safari / Mac App Store** under the WordPress publisher account; Firefox and Edge follow post-1.0. See [`ROADMAP.md`](ROADMAP.md) for what's locked, what's open, and what's next.

## Privacy

No telemetry, no analytics, no third-party tracking. The extension does its work locally — reading the page you're on and (when you're signed in as an admin) calling the site's own REST API for theme and plugin information. Nothing leaves your browser for any service outside the WordPress site you're already visiting.

## Install

### Chrome (developer install, pre-store-release)

1. Download the latest zip from [Releases](https://github.com/WordPress/browser-extension/releases)
2. Unzip to a folder
3. Open `chrome://extensions`, enable **Developer mode**
4. Click **Load unpacked** and select the unzipped folder

### Safari

See [`SAFARI.md`](SAFARI.md) — requires Xcode and a one-time Xcode Run (⌘R).

## Features

- **Detect WordPress** — Identifies WP sites automatically via REST API links, generator tags, asset paths, and body classes. The toolbar icon has three states: gray with a slash for non-WP, gray for WP, blue for WP and logged in.
- **Site icon in the popup header** — When a site has a WordPress Site Icon configured (Customize → Site Identity), it appears next to the hostname in the popup header for fast visual identification.
- **Edit this page** — Jump straight to the editor for posts, pages, categories, tags, authors, and custom post types — including hyphenated CPT slugs like `case-study`. Keyboard shortcut: `Alt+Shift+E` (`Option+Shift+E` on Mac), customizable at `chrome://extensions/shortcuts`.
- **View / Preview from the editor** — On wp-admin edit screens, see the published page or preview a draft (with nonce) in one click. Works for all post types.
- **+ New content menu** — Mirrors the admin bar's "+ New" dropdown with the post types your role can create.
- **Identify the host** — Detects WP Engine, WordPress VIP, Pantheon, Kinsta, Flywheel, Cloudways, WordPress.com, Pressable, and local dev environments. Cached per origin for 90 days.
- **Toggle the admin bar** — Hide or show the front-end admin bar per site, without flash. Honors your profile setting and surfaces a clear hint when WP itself has the bar disabled.
- **One-click sign out** — Inline confirm, then logs out via the admin bar's nonce so WordPress's "are you sure?" page is skipped.
- **Site Information panel** — Active theme (name, version, author) and a wrap of plugin pills with version-on-hover. Pills link to each plugin's homepage. Powered by the WP REST API for admins, with DOM-scanned slugs as a graceful fallback.
- **Developer tools** — Mobile preview window (iPhone-sized), bypass page cache, clear cookies + site data (preserving your WP login), Highlight Blocks (outline `wp-block-*` elements with a breadcrumb tooltip), and a Query Monitor toggle when QM is installed.

## Development

The popup UI is React + [`@wordpress/ui`](https://www.npmjs.com/package/@wordpress/ui), bundled with [10up-toolkit](https://github.com/10up/10up-toolkit). The background service worker, content scripts, and `lib/*.js` are plain JavaScript — no build step there.

```
npm install
npm run build     # production bundle → dist/
npm start         # watch mode
```

Run smoke tests for `lib/` with `cd test && npm install && npm test`.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full contributor flow, conventions, and the permissions-discussion policy.

## Roadmap

See [`ROADMAP.md`](ROADMAP.md) — a **working draft, not a fixed plan**, open to community input. Current v1.0 target: official Chrome Web Store and Safari / Mac App Store releases under the WordPress publisher account, with API and permissions surface frozen. Firefox Add-ons and Edge Add-ons are tracked post-1.0.

## Contributing

Bug reports, design feedback, and PRs all welcome. This project follows the [WordPress Code of Conduct](https://make.wordpress.org/handbook/community-code-of-conduct/).

- **Engineering work**: GitHub Issues + PRs. See [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **UX / design feedback / "should we…?" questions**: [GitHub Discussions](https://github.com/WordPress/browser-extension/discussions).
- **Security issues**: see [`SECURITY.md`](SECURITY.md). Don't open a public issue.

## Maintainers

See [`MAINTAINERS.md`](MAINTAINERS.md). Current maintainer set: [@jakemgold](https://github.com/jakemgold) (Jake Goldman) and [@fabiankaegy](https://github.com/fabiankaegy) (Fabian Kägy) — both at **[Fueled](https://fueled.com/)** (formerly **[10up](https://10up.com/)**).

## License

[MIT](LICENSE). Copyright the contributors. By submitting a contribution you license it under MIT.

## Origin

This project began at [jakemgold/wp-detective](https://github.com/jakemgold/wp-detective) and moved here at v0.8 to become the official WordPress browser extension. The original repository is preserved as the project's archived origin.
