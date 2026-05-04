# WordPress Browser Extension

A browser extension that detects WordPress sites and puts admin shortcuts, hosting info, and developer tools in your toolbar. Chrome is the primary target; Safari is supported via a companion Xcode project.

<p align="center">
  <img src="screenshots/logged-in.png" width="380" alt="Logged in — edit post, host detection, admin bar toggle">
  <img src="screenshots/dev-tools.png" width="380" alt="Developer tools — mobile preview, cache bust, clear site data">
</p>
<p align="center">
  <img src="screenshots/wp-admin.png" width="380" alt="wp-admin editor — view/preview post, visit site">
  <img src="screenshots/logged-out.png" width="380" alt="Logged out — WordPress version detected, login options">
</p>

## Install

### Chrome

1. Download the latest zip from [Releases](https://github.com/jakemgold/wp-detective/releases)
2. Unzip to a folder
3. Open `chrome://extensions`, enable **Developer mode**
4. Click **Load unpacked** and select the unzipped folder

### Safari

See [SAFARI.md](SAFARI.md) — requires Xcode and a one-time Xcode Run (⌘R).

## Features

- **Detect WordPress** — Identifies WP sites automatically via REST API links, generator tags, asset paths, and body classes.
- **Edit any page** — Jump to the WordPress editor for posts, pages, categories, tags, authors, and custom post types. Keyboard shortcut: `Alt+Shift+E` (`Option+Shift+E` on Mac), customizable at `chrome://extensions/shortcuts`.
- **View/Preview from the editor** — See the published page or preview a draft directly from wp-admin. Works for all post types including CPTs.
- **Identify the host** — Detects WP Engine, WordPress VIP, Pantheon, Kinsta, Flywheel, Cloudways, WordPress.com, Pressable, and local dev environments.
- **Toggle the admin bar** — Hide or show the front-end admin bar per site, without flash.
- **Developer tools** — Preview at mobile size, bust CDN cache, clear cookies and site data (preserving your WP login).

## Development

The popup UI is React + [`@wordpress/ui`](https://www.npmjs.com/package/@wordpress/ui), bundled with [10up-toolkit](https://github.com/10up/10up-toolkit). The background service worker, content scripts, and `lib/*.js` are still vanilla — no build step there.

```
npm install
npm run build     # production bundle → dist/
npm start         # watch mode
```

Run smoke tests for `lib/` with `cd test && npm install && npm test`.

## License

MIT

## Like what you see?

<a href="http://10up.com/contact/"><img src="https://github.com/10up/.github/raw/trunk/profile/10up-github-banner.jpg" width="850" alt="Work with the 10up WordPress Practice at Fueled"></a>
