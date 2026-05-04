/**
 * WordPress Browser Extension — hosting provider detection
 *
 * Two-tier detection: DOM asset scanning (sync, no network) followed by
 * HTTP response header inspection (async, one HEAD request). Both are
 * pure functions so they can be unit-tested under jsdom.
 *
 * Loaded as a content script alongside detect.js and rest.js, and also
 * by the popup (for HOST_NAMES only).
 */
(function () {
  'use strict';

  /**
   * Asset-URL patterns that fingerprint a host. Checked against href/src
   * attributes of link, script, and img elements. Order doesn't matter —
   * first match wins.
   */
  const ASSET_PATTERNS = [
    { host: 'wpcom',    patterns: ['.files.wordpress.com', 'public-api.wordpress.com'] },
    { host: 'wpvip',    patterns: ['.go-vip.net', '/mu-plugins/vip-'] },
    { host: 'wpengine', patterns: ['.wpengine.com', '.wpenginepowered.com'] },
    { host: 'pantheon',  patterns: ['.pantheonsite.io'] },
    { host: 'pressable', patterns: ['.mystagingwebsite.com'] },
    { host: 'kinsta',    patterns: ['.kinsta.cloud'] },
  ];

  /**
   * Local dev environment patterns — checked against the hostname.
   * No network needed; this runs before DOM or header detection.
   */
  const LOCAL_PATTERNS = [
    /^localhost$/i,
    /^127\.0\.0\.1$/,
    /^\[::1\]$/,
    /\.localhost$/i,
    /\.local$/i,           // Local by Flywheel, macOS Bonjour
    /\.test$/i,            // IETF reserved for testing
    /\.lndo\.site$/i,      // Lando
    /\.ddev\.site$/i,      // DDEV
  ];

  /**
   * Detect local dev environment from the origin's hostname.
   * Returns 'local' or null.
   */
  function detectHostFromOrigin(origin) {
    try {
      const hostname = new URL(origin).hostname;
      for (const re of LOCAL_PATTERNS) {
        if (re.test(hostname)) return 'local';
      }
    } catch (_) { /* invalid origin */ }
    return null;
  }

  const MAX_ELEMENTS = 200;

  /**
   * Detect hosting provider from DOM elements (sync, no network).
   * Returns a host slug or null.
   */
  function detectHostFromDOM(doc) {
    const els = doc.querySelectorAll('link[href], script[src], img[src]');
    const limit = Math.min(els.length, MAX_ELEMENTS);
    for (let i = 0; i < limit; i++) {
      const url = els[i].getAttribute('href') || els[i].getAttribute('src') || '';
      for (const { host, patterns } of ASSET_PATTERNS) {
        for (const p of patterns) {
          if (url.includes(p)) return host;
        }
      }
    }
    return null;
  }

  /**
   * Response-header signatures, ordered from most specific to least.
   * Automattic family (VIP → Pressable → WP.com) is checked last so
   * that more distinctive hosts match first.
   *
   * `test: null` means the header's mere presence is sufficient.
   */
  const HEADER_CHECKS = [
    { host: 'wpengine',  header: 'wpe-backend',               test: null },
    { host: 'wpengine',  header: 'x-powered-by',              test: /wp engine/i },
    { host: 'pantheon',  header: 'x-pantheon-styx-hostname',   test: null },
    { host: 'kinsta',    header: 'x-kinsta-cache',             test: null },
    { host: 'flywheel',  header: 'server',                     test: /flywheel/i },
    { host: 'cloudways', header: 'server',                     test: /cloudways/i },
    // Automattic family — most specific first
    { host: 'wpvip',     header: 'x-powered-by',              test: /wordpress vip/i },
    { host: 'wpvip',     header: 'x-hacker',                  test: /viphacker/i },
    { host: 'pressable', header: 'x-powered-by',              test: /pressable/i },
    { host: 'wpcom',     header: 'x-powered-by',              test: /wordpress\.com/i },
  ];

  /**
   * Detect hosting provider from HTTP response headers.
   * @param {Headers} headers — a fetch Response.headers object
   * @returns {string|null} host slug
   */
  function detectHostFromHeaders(headers) {
    for (const { host, header, test } of HEADER_CHECKS) {
      const value = headers.get(header);
      if (value === null) continue;
      if (test === null || test.test(value)) return host;
    }
    return null;
  }

  /** Slug → display name. */
  const HOST_NAMES = {
    wpcom:     'WordPress.com',
    wpvip:     'WordPress VIP',
    wpengine:  'WP Engine',
    pantheon:  'Pantheon',
    pressable: 'Pressable',
    kinsta:    'Kinsta',
    flywheel:  'Flywheel',
    cloudways: 'Cloudways',
    local:     'Local Dev',
  };

  globalThis.WPHost = {
    detectHostFromOrigin,
    detectHostFromDOM,
    detectHostFromHeaders,
    HOST_NAMES,
  };
})();
