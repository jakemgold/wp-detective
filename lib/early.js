/**
 * WP Detective — early injection
 *
 * Runs at document_start (before the page body has been parsed) so we can
 * hide the admin bar before it paints. Without this, users see a flash
 * of admin bar on every page load when the "hide" preference is on.
 *
 * Only injects CSS if:
 *   - This origin is already known to be WordPress (in the cache), and
 *   - The user's preference for this origin is to hide the admin bar
 *     (default is hidden).
 *
 * Safe to fail silently — content.js at document_idle will reconcile.
 */
(async function () {
  'use strict';
  try {
    // Never touch the admin bar inside wp-admin — it's part of the UI.
    if (/\/wp-admin(\/|$)/.test(location.pathname)) return;

    const origin = location.origin;

    const [cacheData, prefsData] = await Promise.all([
      chrome.storage.local.get('wp_detection_cache_v1'),
      chrome.storage.local.get('wp_preferences_v1'),
    ]);

    const entry = (cacheData.wp_detection_cache_v1 || {})[origin];
    const prefs = (prefsData.wp_preferences_v1 || {})[origin];

    const isKnownWP = entry && entry.isWordPress;
    const shouldHide = !prefs || prefs.adminBarHidden !== false;

    if (!isKnownWP || !shouldHide) return;

    const style = document.createElement('style');
    style.id = 'wp-detective-adminbar-hide';
    style.textContent = `
      #wpadminbar { display: none !important; }
      html { margin-top: 0 !important; }
      html.admin-bar, html.wp-toolbar { margin-top: 0 !important; }
    `;
    // documentElement exists even before <head>, so this is always safe.
    document.documentElement.appendChild(style);
  } catch (_) {
    // Storage unavailable or extension context invalidated — ignore.
  }
})();
