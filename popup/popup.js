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

      html += actionRow({
        id: 'edit',
        icon: iconEdit,
        label: editLabel(ctx, !!syncUrl || pendingRest),
        hint: pendingRest ? '<span class="spinner"></span>' : null,
        disabled: !syncUrl,
        dataUrl: syncUrl || null,
        newTab: true,
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

  // Cache bust — available on all detected WP pages (logged in or out).
  if (!isWpAdmin) {
    html += actionRow({
      id: 'cachebust',
      icon: iconRefresh,
      label: 'Attempt uncached view',
    });
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

  html += `</div>`;
  root.innerHTML = html;
  wire(result, prefs);
}

function actionRow({ id, icon, label, hint, disabled, destructive, dataUrl, newTab }) {
  // `hint` may contain HTML (e.g. the spinner span) — callers pass raw
  // HTML when they mean to; plain strings are escaped below.
  const hintHtml = hint == null
    ? ''
    : (hint.startsWith('<') ? hint : esc(hint));
  const btn = `
    <button class="action${destructive ? ' destructive' : ''}"
            data-action="${id}"
            ${dataUrl ? `data-url="${esc(dataUrl)}"` : ''}
            ${disabled ? 'disabled' : ''}>
      <span class="action-icon">${icon()}</span>
      <span class="action-label">${esc(label)}</span>
      ${hintHtml ? `<span class="action-hint">${hintHtml}</span>` : ''}
    </button>
  `;
  if (!newTab) return btn;
  return `
    <div class="action-wrap">
      ${btn}
      <button class="action-newtab" data-action="${id}" title="Open in new tab"
              ${disabled ? 'disabled' : ''}>${iconNewTab()}</button>
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
  }
  if (!target) return;
  if (newTab) {
    await chrome.tabs.create({ url: target });
  } else {
    await chrome.tabs.update({ url: target });
  }
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
  const label = btn.querySelector('.action-label');
  const hint  = btn.querySelector('.action-hint');

  if (resolvedUrl) {
    btn.disabled = false;
    btn.dataset.url = resolvedUrl;
    if (newtabBtn) newtabBtn.disabled = false;
    if (label) label.textContent = editLabel(ctx, true);
    if (hint) hint.remove();
  } else {
    btn.disabled = true;
    if (newtabBtn) newtabBtn.disabled = true;
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
function iconNewTab() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5H13.5V7"/><path d="M13.5 2.5L7.5 8.5"/><path d="M11 9v3.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1H7"/></svg>`;
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
