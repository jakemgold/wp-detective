/**
 * WP Detective — content script (document_idle)
 *
 * Responsibilities:
 *   1. Run detection against the loaded DOM and report to background.
 *   2. Respond to popup requests for live (fresh) detection.
 *   3. Apply the admin bar visibility preference for this origin,
 *      and toggle in response to popup messages.
 */
(function () {
  'use strict';

  if (!document.body || !document.documentElement) return;

  // -- Detection + reporting -----------------------------------------------

  const detection = globalThis.WPDetect.detectWordPress(document);
  if (!detection.context.isLoggedIn) {
    detection.context.isLoggedIn =
      globalThis.WPDetect.detectLoggedInFromCookies(document.cookie);
  }

  try {
    chrome.runtime.sendMessage({
      type: 'WP_DETECTION',
      url: location.href,
      origin: location.origin,
      pathname: location.pathname,
      detection,
    });
  } catch (_) { /* extension context invalidated */ }

  // -- Admin bar visibility ------------------------------------------------

  let hideStyle = document.getElementById('wp-detective-adminbar-hide');
  let removedClasses = [];

  async function loadAdminBarPref() {
    try {
      const data = await chrome.storage.local.get('wp_preferences_v1');
      const prefs = (data.wp_preferences_v1 || {})[location.origin];
      // Default: hidden.
      return !prefs || prefs.adminBarHidden !== false;
    } catch (_) {
      return true;
    }
  }

  function applyHide() {
    if (!hideStyle) {
      hideStyle = document.createElement('style');
      hideStyle.id = 'wp-detective-adminbar-hide';
      hideStyle.textContent = `
        #wpadminbar { display: none !important; }
        html { margin-top: 0 !important; }
        html.admin-bar, html.wp-toolbar { margin-top: 0 !important; }
      `;
      document.documentElement.appendChild(hideStyle);
    }
    // Remove the classes WP uses to style the page as "logged-in" —
    // track what we removed so we can restore cleanly.
    if (document.body) {
      ['logged-in', 'admin-bar'].forEach((cls) => {
        if (document.body.classList.contains(cls)) {
          document.body.classList.remove(cls);
          if (!removedClasses.includes(cls)) removedClasses.push(cls);
        }
      });
    }
  }

  function applyShow() {
    if (hideStyle) {
      hideStyle.remove();
      hideStyle = null;
    }
    if (document.body) {
      removedClasses.forEach((cls) => document.body.classList.add(cls));
      removedClasses = [];
    }
    // Note: the admin bar's own JS initializes on page load. Hover menus,
    // notifications, etc. may not function fully until the page is
    // reloaded. Visually it's correct; interactively it may be partial.
  }

  // Only manage admin bar visibility when it's actually on the page.
  if (detection.context.isLoggedIn) {
    loadAdminBarPref().then((hidden) => {
      if (hidden) applyHide();
      else applyShow();
    });
  }

  // -- Popup messaging -----------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;

    if (msg.type === 'GET_LIVE_DETECTION') {
      const fresh = globalThis.WPDetect.detectWordPress(document);
      if (!fresh.context.isLoggedIn) {
        fresh.context.isLoggedIn =
          globalThis.WPDetect.detectLoggedInFromCookies(document.cookie);
      }
      sendResponse({
        url: location.href,
        origin: location.origin,
        pathname: location.pathname,
        detection: fresh,
      });
      return;
    }

    if (msg.type === 'APPLY_ADMIN_BAR_PREF') {
      if (msg.hidden) applyHide();
      else applyShow();
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'RESOLVE_EDIT_URL_REST') {
      // Async — return true to keep the message channel open while we
      // hit the REST API from the page context (same-origin, cookies
      // flow for free).
      const fresh = globalThis.WPDetect.detectWordPress(document);
      if (!fresh.context.isLoggedIn) {
        fresh.context.isLoggedIn =
          globalThis.WPDetect.detectLoggedInFromCookies(document.cookie);
      }
      globalThis.WPRest
        .resolveEditUrlAsync(fresh.context, location.origin)
        .then((url) => sendResponse({ url: url || null }))
        .catch(() => sendResponse({ url: null }));
      return true;
    }
  });
})();
