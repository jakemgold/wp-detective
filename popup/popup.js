/**
 * WP Detective — popup controller
 *
 * Flow:
 *   1. Find the active tab.
 *   2. Ask the content script for live detection (freshest context).
 *   3. If that fails (e.g. chrome:// page, or content script didn't load),
 *      fall back to the cached background entry.
 *   4. Render the appropriate state.
 */

const PREFS_KEY = 'wp_preferences_v1';
const DEFAULT_PREFS = { adminBarHidden: true };

const root = document.getElementById('root');

init().catch((err) => {
  console.error('WP Detective popup error:', err);
  renderError();
});

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
    renderNotSupported();
    return;
  }

  const url = new URL(tab.url);
  const origin = url.origin;

  // 1. Try the content script — freshest data, includes live context.
  let result = null;
  try {
    result = await chrome.tabs.sendMessage(tab.id, { type: 'GET_LIVE_DETECTION' });
  } catch (_) { /* content script unreachable */ }

  // 2. Always fetch the cached entry — live detection doesn't carry
  //    host info (it's resolved asynchronously by the background).
  const cached = await chrome.runtime.sendMessage({
    type: 'GET_CACHED_DETECTION', origin,
  });

  if (!result) {
    if (cached && cached.isWordPress) {
      result = {
        url: tab.url,
        origin,
        pathname: url.pathname,
        detection: {
          isWordPress: true,
          confidence: cached.confidence,
          signals: cached.signals,
          context: {}, // no live context
        },
      };
    }
  }

  const prefs = await loadPrefs(origin);

  if (!result || !result.detection.isWordPress) {
    renderNotWordPress(url.hostname);
    return;
  }

  renderDetected(result, prefs, cached?.host || null);
}

// -- Rendering -----------------------------------------------------------

function renderNotSupported() {
  root.innerHTML = `
    <div class="empty">
      <div class="empty-title display">Nothing to inspect here</div>
      <div class="empty-hint">Open a website to get started</div>
    </div>
  `;
}

function renderNotWordPress(hostname) {
  root.innerHTML = `
    <div class="header">
      <div class="status-row">
        <span class="status-dot"></span>
        <span class="domain">${esc(hostname)}</span>
      </div>
    </div>
    <div class="empty">
      <div class="empty-title display">Not a WordPress site</div>
      <div class="empty-hint">No signals detected</div>
    </div>
  `;
}

function renderError() {
  root.innerHTML = `
    <div class="empty">
      <div class="empty-title display">Something went wrong</div>
      <div class="empty-hint">Check the service-worker logs</div>
    </div>
  `;
}

function renderDetected(result, prefs, host) {
  const { detection, origin, url } = result;
  const ctx = detection.context || {};
  const isLoggedIn = !!ctx.isLoggedIn;
  const hostname = new URL(origin).hostname;
  const isWpAdmin = /\/wp-admin(\/|$)/.test(new URL(url).pathname);

  // Meta strip: show host name when detected, fall back to WordPress + version
  const metaParts = [];
  if (host) {
    const hostName = globalThis.WPHost.HOST_NAMES[host] || host;
    metaParts.push(esc(hostName));
  } else if (ctx.generatorVersion) {
    metaParts.push(`WordPress ${esc(ctx.generatorVersion)}`);
  } else {
    metaParts.push('WordPress');
  }
  if (isLoggedIn) metaParts.push('<span class="logged-in-badge">logged in</span>');

  let html = `
    <div class="header">
      <div class="status-row">
        <span class="status-dot active"></span>
        <span class="domain">${esc(hostname)}</span>
      </div>
      <div class="meta">
        ${metaParts.join('<span class="sep">·</span>')}
      </div>
    </div>
    <div class="actions">
  `;

  if (isLoggedIn) {
    if (isWpAdmin) {
      // If the admin bar has a view/preview link, the user is on an
      // edit screen. WordPress provides the correct URL — including the
      // preview nonce for drafts — so we use it directly.
      if (ctx.adminBarViewHref) {
        const typeLabel = ctx.postType ? postTypeLabel(ctx.postType) : 'Page';
        const verb = ctx.postStatus === 'publish' ? 'View' : 'Preview';
        html += actionRow({
          id: 'view-post',
          icon: iconEye,
          label: `${verb} this ${typeLabel}`,
          newTab: true,
          copyUrl: true,
          dataUrl: ctx.adminBarViewHref,
        });
      }
      html += actionRow({
        id: 'visit-site',
        icon: iconGlobe,
        label: 'Visit site',
        newTab: true,
      });
    } else {
      // Two-tier resolution: sync first (instant), then kick off REST as a
      // fallback for slugs that need an ID lookup. The button starts
      // disabled with a spinner and upgrades in place once REST comes back.
      const syncUrl = resolveEditUrlSync(ctx, origin);
      const pendingRest = !syncUrl && canResolveViaRest(ctx);

      const isMac = navigator.platform?.startsWith('Mac') ?? false;
      const shortcutHint = isMac ? 'Alt⇧E' : 'Alt+Shift+E';

      html += actionRow({
        id: 'edit',
        icon: iconEdit,
        label: editLabel(ctx, !!syncUrl || pendingRest),
        hint: pendingRest ? '<span class="spinner"></span>' : shortcutHint,
        hintTitle: isMac
          ? 'Edit this page by pressing Option + Shift + E'
          : 'Edit this page by pressing Alt + Shift + E',
        disabled: !syncUrl,
        dataUrl: syncUrl || null,
        newTab: true,
        copyUrl: true,
      });
    }
    html += actionRow({
      id: 'admin',
      icon: iconGauge,
      label: 'WordPress Admin Dashboard',
      newTab: true,
    });

    if (isWpAdmin) {
      // No toggle inside wp-admin — the toolbar is part of the admin UI.
    } else if (!ctx.hasAdminBar) {
      // WordPress didn't render the admin bar (profile setting is off).
      html += `
        <div class="info-row">
          <span class="info-text">Toolbar disabled in WordPress</span>
          <button class="info-link" data-action="profile">Change in profile &rarr;</button>
        </div>
      `;
    } else {
      html += `
        <label class="toggle-row" id="toggle-row">
          <span class="action-icon">${iconCursor()}</span>
          <div class="toggle-label">
            <div class="toggle-label-title">Show admin bar</div>
          </div>
          <div class="toggle-switch ${prefs.adminBarHidden ? '' : 'on'}" id="toggle-switch"></div>
        </label>
      `;
    }

  } else {
    html += actionRow({ id: 'login',        icon: iconKey,    label: 'Admin login', newTab: true });
    html += actionRow({ id: 'login-return', icon: iconReturn, label: 'Admin login, return to page', newTab: true });
  }

  if (isLoggedIn) {
    html += `
      <div class="action-wrap signout-wrap" id="signout-wrap">
        <button class="action destructive" id="signout-btn">
          <span class="action-icon">${iconSignOut()}</span>
          <span class="action-label">Sign out</span>
        </button>
        <button class="signout-confirm" id="signout-confirm">Confirm</button>
      </div>
    `;
  }

  if (!isWpAdmin) {
    html += `
      <button class="devtools-toggle" id="devtools-toggle">
        <span class="devtools-label">Developer tools</span>
        <span class="devtools-chevron" id="devtools-chevron">&#x25B8;</span>
      </button>
      <div class="devtools-panel" id="devtools-panel">
    `;
    html += actionRow({
      id: 'mobile-preview',
      icon: iconPhone,
      label: 'Preview mobile size',
    });
    html += actionRow({
      id: 'cachebust',
      icon: iconRefresh,
      label: 'Attempt uncached view',
    });
    html += `
      <div class="action-wrap" id="cleardata-wrap">
        <button class="action" id="cleardata-btn"
                title="Clear all cookies, localStorage, and sessionStorage for this site. WordPress login cookies are preserved. Useful for testing forms, cache behavior, and tracking scripts.">
          <span class="action-icon">${iconTrash()}</span>
          <span class="action-label">Clear cookies & data (keep WP login)</span>
        </button>
        <button class="cleardata-confirm" id="cleardata-confirm">Confirm</button>
      </div>
    `;
    html += `</div>`;
  }

  html += `</div>`;
  root.innerHTML = html;
  wire(result, prefs);
}

function actionRow({ id, icon, label, hint, hintTitle, disabled, destructive, dataUrl, newTab, copyUrl }) {
  // `hint` may contain HTML (e.g. the spinner span) — callers pass raw
  // HTML when they mean to; plain strings are escaped below.
  const hintHtml = hint == null
    ? ''
    : (hint.startsWith('<') ? hint : esc(hint));
  const titleAttr = hintTitle ? ` title="${esc(hintTitle)}"` : '';
  const btn = `
    <button class="action${destructive ? ' destructive' : ''}"
            data-action="${id}"
            ${dataUrl ? `data-url="${esc(dataUrl)}"` : ''}
            ${disabled ? 'disabled' : ''}>
      <span class="action-icon">${icon()}</span>
      <span class="action-label">${esc(label)}</span>
      ${hintHtml ? `<span class="action-hint"${titleAttr}>${hintHtml}</span>` : ''}
    </button>
  `;
  if (!newTab && !copyUrl) return btn;
  const copyBtn = copyUrl
    ? `<button class="action-copy" data-action="${id}" title="Copy URL"
              ${disabled ? 'disabled' : ''}>${iconCopy()}</button>`
    : '';
  const newTabBtn = newTab
    ? `<button class="action-newtab" data-action="${id}" title="Open in new tab"
              ${disabled ? 'disabled' : ''}>${iconNewTab()}</button>`
    : '';
  return `
    <div class="action-wrap">
      ${btn}${copyBtn}${newTabBtn}
    </div>
  `;
}

// -- Actions -------------------------------------------------------------

function wire(result, prefs) {
  const { origin, url, detection } = result;
  const ctx = detection.context || {};

  document.querySelectorAll('.action[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      handleAction(btn.dataset.action, { origin, url, ctx });
    });
  });

  document.querySelectorAll('.action-newtab[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      handleAction(btn.dataset.action, { origin, url, ctx }, true);
    });
  });

  document.querySelectorAll('.action-copy[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const action = btn.dataset.action;
      const actionBtn = btn.parentElement?.querySelector(`.action[data-action="${action}"]`);
      const copyUrl = actionBtn?.dataset.url;
      if (!copyUrl) return;
      try {
        await navigator.clipboard.writeText(copyUrl);
        btn.classList.add('copied');
        setTimeout(() => btn.classList.remove('copied'), 1500);
      } catch (_) { /* clipboard denied */ }
    });
  });

  // Async edit URL resolution — if sync came up empty but context has
  // slugs we can look up, ask the content script to hit the REST API.
  // Skip on wp-admin where the edit button isn't shown.
  const isWpAdmin = /\/wp-admin(\/|$)/.test(new URL(url).pathname);
  if (!isWpAdmin && ctx.isLoggedIn && canResolveViaRest(ctx) && !resolveEditUrlSync(ctx, origin)) {
    kickoffRestResolution(ctx);
  }

  const toggle = document.getElementById('toggle-switch');
  const toggleRow = document.getElementById('toggle-row');

  if (toggleRow) {
    toggleRow.addEventListener('click', async (e) => {
      e.preventDefault();
      const newHidden = !prefs.adminBarHidden;
      prefs.adminBarHidden = newHidden;
      await savePref(origin, 'adminBarHidden', newHidden);

      toggle.classList.toggle('on', !newHidden);

      // Apply live
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'APPLY_ADMIN_BAR_PREF',
          hidden: newHidden,
        });
      } catch (_) { /* content script gone — next load will pick it up */ }
    });
  }

  // Developer tools: collapsible section, state persisted globally.
  const devtoolsToggle = document.getElementById('devtools-toggle');
  const devtoolsPanel = document.getElementById('devtools-panel');
  const devtoolsChevron = document.getElementById('devtools-chevron');

  if (devtoolsToggle && devtoolsPanel) {
    // Restore persisted state
    chrome.storage.local.get('wp_devtools_open').then((data) => {
      if (data.wp_devtools_open) {
        devtoolsPanel.classList.add('open');
        devtoolsChevron.classList.add('open');
      }
    });

    devtoolsToggle.addEventListener('click', async () => {
      const isOpen = devtoolsPanel.classList.toggle('open');
      devtoolsChevron.classList.toggle('open', isOpen);
      await chrome.storage.local.set({ wp_devtools_open: isOpen });
    });
  }

  // Sign-out: first click reveals a "Confirm" button that auto-hides
  // after 10 seconds. No modal, no accidental logouts.
  const signoutBtn = document.getElementById('signout-btn');
  const signoutConfirm = document.getElementById('signout-confirm');
  let signoutTimer = null;

  if (signoutBtn && signoutConfirm) {
    signoutBtn.addEventListener('click', () => {
      const showing = signoutConfirm.classList.toggle('visible');
      clearTimeout(signoutTimer);
      if (showing) {
        signoutTimer = setTimeout(() => {
          signoutConfirm.classList.remove('visible');
        }, 10000);
      }
    });

    signoutConfirm.addEventListener('click', (e) => {
      e.stopPropagation();
      clearTimeout(signoutTimer);
      handleAction('signout', { origin, url, ctx });
    });
  }

  // Clear data: same inline confirm pattern as sign-out.
  const cleardataBtn = document.getElementById('cleardata-btn');
  const cleardataConfirm = document.getElementById('cleardata-confirm');
  let cleardataTimer = null;

  if (cleardataBtn && cleardataConfirm) {
    cleardataBtn.addEventListener('click', () => {
      const showing = cleardataConfirm.classList.toggle('visible');
      clearTimeout(cleardataTimer);
      if (showing) {
        cleardataTimer = setTimeout(() => {
          cleardataConfirm.classList.remove('visible');
        }, 10000);
      }
    });

    cleardataConfirm.addEventListener('click', (e) => {
      e.stopPropagation();
      clearTimeout(cleardataTimer);
      handleAction('clear-data', { origin, url, ctx });
    });
  }
}

async function handleAction(action, { origin, url, ctx }, newTab = false) {
  let target;
  switch (action) {
    case 'edit': {
      // Prefer the URL stored on the button itself — it's set when either
      // sync resolution succeeded at render time, or async REST resolution
      // upgraded the button in place.
      const btn = document.querySelector('.action[data-action="edit"]');
      target = btn?.dataset.url || resolveEditUrlSync(ctx, origin);
      break;
    }
    case 'view-post': {
      const btn = document.querySelector('.action[data-action="view-post"]');
      target = btn?.dataset.url || null;
      break;
    }
    case 'visit-site':   target = `${origin}/`; break;
    case 'admin':        target = `${origin}/wp-admin/`; break;
    case 'profile':      target = `${origin}/wp-admin/profile.php`; break;
    case 'login':        target = `${origin}/wp-login.php`; break;
    case 'login-return': target = `${origin}/wp-login.php?redirect_to=${encodeURIComponent(url)}`; break;
    // /wp-login.php?action=logout shows WP's "are you sure?" confirmation,
    // which is the safe UX — no accidental sign-outs from the popup.
    case 'signout':      target = `${origin}/wp-login.php?action=logout`; break;
    case 'cachebust': {
      const bust = Math.random().toString(36).slice(2, 7);
      const u = new URL(url);
      u.searchParams.set('cachebust', bust);
      target = u.toString();
      break;
    }
    case 'mobile-preview': {
      // Popup window sized to match an iPhone 16/17 Pro (393 × 852).
      // Chrome's popup type adds ~60px of chrome (title bar + URL bar),
      // so the actual viewport is slightly shorter — close enough for
      // a responsive preview without the window looking oversized.
      await chrome.windows.create({
        url,
        type: 'popup',
        width: 393,
        height: 852,
      });
      window.close();
      return;
    }
    case 'clear-data': {
      await clearSiteData(origin, url);
      return;
    }
  }
  if (!target) return;
  if (newTab) {
    await chrome.tabs.create({ url: target });
  } else {
    await chrome.tabs.update({ url: target });
  }
  window.close();
}

// -- Clear site data -----------------------------------------------------

const WP_COOKIE_PATTERNS = [
  /^wordpress_/,
  /^wp-settings-/,
  /^wp_/,
];

function isWpCookie(name) {
  return WP_COOKIE_PATTERNS.some((re) => re.test(name));
}

async function clearSiteData(origin, url) {
  // 1. Remove all cookies for this origin except WordPress auth cookies.
  const parsedUrl = new URL(origin);
  const allCookies = await chrome.cookies.getAll({ domain: parsedUrl.hostname });
  const removePromises = allCookies
    .filter((c) => !isWpCookie(c.name))
    .map((c) => {
      const cookieUrl = `${c.secure ? 'https' : 'http'}://${c.domain.replace(/^\./, '')}${c.path}`;
      return chrome.cookies.remove({ url: cookieUrl, name: c.name });
    });
  await Promise.all(removePromises);

  // 2. Clear localStorage and sessionStorage via the content script.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        try { localStorage.clear(); } catch (_) {}
        try { sessionStorage.clear(); } catch (_) {}
      },
    });
  } catch (_) { /* content script unreachable */ }

  // 3. Reload the page so the clean state takes effect.
  await chrome.tabs.reload(tab.id);
  window.close();
}

// -- Edit URL resolution -------------------------------------------------

// Thin wrappers around the shared WPRest module (loaded by popup.html).
// Delegating here keeps all URL-construction logic in one place.
function resolveEditUrlSync(ctx, origin) {
  return globalThis.WPRest.resolveEditUrlSync(ctx, origin);
}

function canResolveViaRest(ctx) {
  return globalThis.WPRest.canResolveViaRest(ctx);
}

/**
 * Asks the content script to do a REST lookup. The fetch runs in the
 * page's origin so cookies flow and CORS doesn't apply. On success we
 * upgrade the Edit button in place; on failure we collapse it to a
 * disabled "coming soon" state.
 */
async function kickoffRestResolution(ctx) {
  let resolvedUrl = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'RESOLVE_EDIT_URL_REST' });
    resolvedUrl = res && res.url ? res.url : null;
  } catch (_) { /* content script gone — treat as failure */ }

  const btn = document.querySelector('.action[data-action="edit"]');
  if (!btn) return; // popup closed or re-rendered

  const newtabBtn = document.querySelector('.action-newtab[data-action="edit"]');
  const copyBtn = document.querySelector('.action-copy[data-action="edit"]');
  const label = btn.querySelector('.action-label');
  const hint  = btn.querySelector('.action-hint');

  if (resolvedUrl) {
    btn.disabled = false;
    btn.dataset.url = resolvedUrl;
    if (newtabBtn) newtabBtn.disabled = false;
    if (copyBtn) copyBtn.disabled = false;
    if (label) label.textContent = editLabel(ctx, true);
    if (hint) hint.remove();
  } else {
    btn.disabled = true;
    if (newtabBtn) newtabBtn.disabled = true;
    if (copyBtn) copyBtn.disabled = true;
    if (label) label.textContent = editDisabledLabel(ctx);
    if (hint) hint.remove();
  }
}

/**
 * Context-aware label for the edit row. `editable` controls whether we
 * use the live verb (resolving or resolved) or the disabled fallback.
 */
function editLabel(ctx, editable) {
  if (!editable) return editDisabledLabel(ctx);
  if (ctx.pageType === 'term') {
    if (ctx.taxonomy === 'category') return 'Edit this Category';
    if (ctx.taxonomy === 'post_tag') return 'Edit this Tag';
    return 'Edit this Term';
  }
  if (ctx.pageType === 'author') return 'Edit this Author';
  if (ctx.postType) return `Edit this ${postTypeLabel(ctx.postType)}`;
  return 'Edit this page';
}

function editDisabledLabel(ctx) {
  if (ctx.pageType === 'archive') return 'Edit archive (coming soon)';
  if (ctx.pageType === 'home')    return 'Edit homepage (coming soon)';
  if (ctx.pageType === 'term')    return 'Edit term (not resolvable)';
  if (ctx.pageType === 'author')  return 'Edit author (not resolvable)';
  if (ctx.pageType === 'search' || ctx.pageType === '404') return 'Nothing to edit';
  return 'Edit this page';
}

/**
 * Turns a WP post type slug into a human-readable label. Built-in types
 * get friendly names; custom post type slugs are title-cased. For CPTs
 * whose registered label differs significantly from their slug (e.g.
 * slug "kb_article", label "Knowledge Base Article"), this won't be
 * perfect — a REST lookup to /wp/v2/types could resolve that in the
 * future.
 */
function postTypeLabel(postType) {
  switch (postType) {
    case 'post':             return 'Post';
    case 'page':             return 'Page';
    case 'attachment':       return 'Media';
    case 'wp_block':         return 'Block Pattern';
    case 'wp_template':      return 'Template';
    case 'wp_template_part': return 'Template Part';
    case 'wp_navigation':    return 'Navigation Menu';
    default:
      return postType
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

// -- Preferences ---------------------------------------------------------

async function loadPrefs(origin) {
  const data = await chrome.storage.local.get(PREFS_KEY);
  const all = data[PREFS_KEY] || {};
  return { ...DEFAULT_PREFS, ...(all[origin] || {}) };
}

async function savePref(origin, key, value) {
  const data = await chrome.storage.local.get(PREFS_KEY);
  const all = data[PREFS_KEY] || {};
  all[origin] = { ...DEFAULT_PREFS, ...(all[origin] || {}), [key]: value };
  await chrome.storage.local.set({ [PREFS_KEY]: all });
}

// -- Icons (inline SVG — no external deps) -------------------------------

function iconEdit() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5L13.5 4.5L5 13H3V11L11.5 2.5Z"/></svg>`;
}
function iconGauge() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 11a5.5 5.5 0 0 1 11 0"/><path d="M8 11L11 7.5"/><circle cx="8" cy="11" r="0.9" fill="currentColor" stroke="none"/></svg>`;
}
function iconKey() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="10" r="2.5"/><path d="M7.8 8.2L13.5 2.5"/><path d="M11.5 4.5L13 6"/><path d="M10 6L11.5 7.5"/></svg>`;
}
function iconReturn() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.5L6 3.5M3 6.5L6 9.5M3 6.5H11a2 2 0 0 1 2 2V12"/></svg>`;
}
function iconEye() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z"/><circle cx="8" cy="8" r="2"/></svg>`;
}
function iconGlobe() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11"/><ellipse cx="8" cy="8" rx="2.5" ry="5.5"/></svg>`;
}
function iconCopy() {
  return `<svg class="icon-copy" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="8" height="8" rx="1"/><path d="M3 11V3a1 1 0 0 1 1-1h8"/></svg><svg class="icon-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5L6.5 11.5L12.5 4.5"/></svg>`;
}
function iconNewTab() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5H13.5V7"/><path d="M13.5 2.5L7.5 8.5"/><path d="M11 9v3.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1H7"/></svg>`;
}
function iconTrash() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h10"/><path d="M6 4V2.5h4V4"/><path d="M4.5 4l.5 9h6l.5-9"/></svg>`;
}
function iconPhone() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="1.5" width="8" height="13" rx="1.5"/><line x1="6.5" y1="12" x2="9.5" y2="12"/></svg>`;
}
function iconRefresh() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.5A5.5 5.5 0 0 1 13 5"/><path d="M13.5 9.5A5.5 5.5 0 0 1 3 11"/><path d="M13 2v3h-3"/><path d="M3 14v-3h3"/></svg>`;
}
function iconCursor() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2.5L3 12L6 9L9.5 13L11.5 11.5L8 8L12 7L3 2.5Z"/></svg>`;
}
function iconSignOut() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h5"/><path d="M7 8H14M14 8L11.5 5.5M14 8L11.5 10.5"/></svg>`;
}

// -- utils ---------------------------------------------------------------

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
