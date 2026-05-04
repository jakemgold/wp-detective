/**
 * WordPress Browser Extension — content script (document_idle)
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

  // Host detection: origin check first (catches local dev), then DOM
  // scan (free). Both are sync — include the result so the background
  // can skip the HEAD request when a signal is present.
  const hostFromDOM = detection.isWordPress
    ? (globalThis.WPHost.detectHostFromOrigin(location.origin) ||
       globalThis.WPHost.detectHostFromDOM(document))
    : null;

  try {
    chrome.runtime.sendMessage({
      type: 'WP_DETECTION',
      url: location.href,
      origin: location.origin,
      pathname: location.pathname,
      detection,
      hostFromDOM,
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
        html { margin-top: 0 !important; --wp-admin--admin-bar--height: 0px !important; }
        html.admin-bar, html.wp-toolbar { margin-top: 0 !important; --wp-admin--admin-bar--height: 0px !important; }
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

  // Only manage admin bar visibility on the front end — never inside
  // wp-admin, where the toolbar is integral to the admin UI.
  const isWpAdmin = /\/wp-admin(\/|$)/.test(location.pathname);
  if (detection.context.isLoggedIn && !isWpAdmin) {
    loadAdminBarPref().then((hidden) => {
      if (hidden) applyHide();
      else applyShow();
    });
  }

  // -- Popup messaging -----------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;

    if (msg.type === 'GET_LIVE_DETECTION') {
      // Re-run detection on demand. The IIFE-scope `detection` captured at
      // document_idle goes stale when the user logs in elsewhere and returns
      // to a BFCache'd or page-cached version of this URL.
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

    if (msg.type === 'GET_FRESH_DETECTION') {
      // Bypasses the browser HTTP cache and BFCache via cache: 'no-store'
      // and re-runs detection against the freshly fetched HTML. Used by the
      // popup when the live DOM is stale (admin bar missing despite the user
      // being logged in per chrome.cookies). Page caches that vary on the
      // auth cookie return logged-in HTML here; ones that don't return the
      // same stale response, in which case the popup falls back to a reload
      // prompt.
      fetch(location.href, {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })
        .then(async (res) => {
          if (!res.ok) return sendResponse({ detection: null });
          const html = await res.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const det = globalThis.WPDetect.detectWordPress(doc);
          if (!det.context.isLoggedIn) {
            det.context.isLoggedIn =
              globalThis.WPDetect.detectLoggedInFromCookies(document.cookie);
          }
          sendResponse({ detection: det });
        })
        .catch(() => sendResponse({ detection: null }));
      return true; // async
    }

    if (msg.type === 'APPLY_ADMIN_BAR_PREF') {
      // Never toggle the admin bar inside wp-admin.
      if (!isWpAdmin) {
        if (msg.hidden) applyHide();
        else applyShow();
      }
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'RESOLVE_HOST_HEADERS') {
      // Same-origin HEAD request — cookies flow, no CORS, minimal payload.
      fetch(location.href, { method: 'HEAD', credentials: 'include' })
        .then((res) => {
          const host = globalThis.WPHost.detectHostFromHeaders(res.headers);
          sendResponse({ host });
        })
        .catch(() => sendResponse({ host: null }));
      return true;
    }

    if (msg.type === 'RESOLVE_EDIT_URL_REST') {
      // Async — return true to keep the message channel open while we
      // hit the REST API from the page context (same-origin, cookies
      // flow for free).
      globalThis.WPRest
        .resolveEditUrlAsync(detection.context, location.origin)
        .then((url) => sendResponse({ url: url || null }))
        .catch(() => sendResponse({ url: null }));
      return true;
    }

    if (msg.type === 'TOGGLE_QUERY_MONITOR') {
      // QM toggles its main panel via a click on the admin-bar link, OR
      // directly via the `.qm-show` class on #query-monitor-main. The
      // admin-bar click path is preferred because it also handles the
      // keyboard focus trap QM sets up; we fall back to the class toggle
      // when the admin bar isn't rendered (user hid it).
      const barLink = document.querySelector('#wp-admin-bar-query-monitor > a');
      const panel = document.getElementById('query-monitor-main');
      if (barLink) {
        barLink.click();
      } else if (panel) {
        panel.classList.toggle('qm-show');
        panel.classList.toggle('qm-peek', false);
      }
      sendResponse({ ok: !!(barLink || panel) });
      return;
    }
  });
})();
