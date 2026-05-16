# Contributing to WordPress Browser Extension

Thanks for considering a contribution. This project follows the WordPress project's general code-contribution norms and the [WordPress Code of Conduct](https://make.wordpress.org/handbook/community-code-of-conduct/).

## Reporting bugs

Open a [GitHub Issue](https://github.com/WordPress/browser-extension/issues) with:

- Browser + version (Chrome / Safari / Firefox / Edge)
- Operating system
- Extension version (from `chrome://extensions` or Safari → Settings → Extensions)
- The URL where it happened, or a representative public WordPress site that reproduces the issue
- Reproduction steps
- Expected behavior vs. observed behavior
- Console errors / screenshots if relevant

For **security issues**, see [`SECURITY.md`](SECURITY.md). Do not open a public issue.

## Design feedback / open questions

For UX questions, "should we…?" discussions, demo recordings, or feature ideas without a concrete acceptance criterion, use [GitHub Discussions](https://github.com/WordPress/browser-extension/discussions).

## Code contributions

### Setup

```bash
git clone https://github.com/WordPress/browser-extension.git
cd browser-extension
npm install
npm run build     # production bundle → dist/
# OR
npm start         # watch mode for development
```

Load the repo into Chrome via `chrome://extensions` → Developer mode → **Load unpacked**, pointing at the repo root (the manifest sits at the top level; the popup bundle lives under `dist/popup/`).

For Safari development, see [`SAFARI.md`](SAFARI.md).

### Testing

```bash
cd test && npm install && npm test
```

Smoke tests cover the vanilla `lib/*.js` modules. Test before opening a PR.

### Architecture notes

- The popup UI is React + [`@wordpress/ui`](https://www.npmjs.com/package/@wordpress/ui), bundled with [10up-toolkit](https://github.com/10up/10up-toolkit) → `dist/popup/`.
- The background service worker (`background.js`), content scripts (`content.js`), and `lib/*.js` are plain JavaScript — no build step there. Don't introduce a bundler dependency for those without discussion.
- The Safari build re-uses the Chrome runtime via `npm run build:safari`, which rsyncs all shipping files into the Xcode project resources.

### Conventions

- **Permissions**. Every entry in `manifest.json`'s `permissions` and `host_permissions` is an Issue-level discussion before being added. The principle is least privilege; users install browser extensions on the trust that they ask for what they need and nothing more.
- **JS**. ES2020+ syntax; no transpilation needed for non-popup code (Chrome and Safari both support it). Prefer plain modules over framework where possible — React is reserved for popup UI.
- **Comments**. Explain WHY, not WHAT. Inline rationale for non-obvious decisions; don't narrate the obvious.

### Pull requests

1. Fork the repo, create a feature branch off `main`.
2. Keep PRs small and focused (one concern per PR).
3. Run the test suite locally and check the popup loads in Chrome with `npm run build` + a Load Unpacked.
4. Open the PR against `main`. Reference any related Discussion or Issue.

By submitting a contribution you license it under MIT. We don't require a CLA.

## Maintainers

See [`MAINTAINERS.md`](MAINTAINERS.md) for the current set + how to reach them.
