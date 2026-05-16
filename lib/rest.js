/**
 * WordPress Browser Extension — REST API helpers
 *
 * Pure async functions for resolving context → admin URL via the WP REST
 * API. Runs inside the content script (same-origin as the page), so cookies
 * flow naturally and there is no CORS involvement.
 *
 * `fetch` is injected for testability: any of these can be unit-tested
 * under jsdom with a mocked fetch that returns canned WP responses.
 */
(function () {
  'use strict';

  // Built-in taxonomy → REST base. Custom taxonomies usually expose
  // rest_base equal to their taxonomy slug, which is what we fall back
  // to when there's no entry here.
  const TAX_REST_BASE = {
    category: 'categories',
    post_tag: 'tags',
  };

  /**
   * Normalizes a REST root to end with '/'. Accepts the value captured
   * from <link rel="https://api.w.org/">, or an empty/missing value in
   * which case we synthesize the conventional `${origin}/wp-json/`.
   */
  function normalizeRoot(restApiRoot, origin) {
    const root = restApiRoot || `${origin}/wp-json/`;
    return root.endsWith('/') ? root : root + '/';
  }

  /**
   * Best-effort extraction of the WP REST nonce from a Document. Content
   * scripts can't reach page-context globals like `window.wpApiSettings`
   * directly, so we scan the DOM surface that mirrors them: inline
   * `<script>` blocks (where wp_enqueue_script(`wp-api`) prints the
   * config object) and a couple of well-known data-* attributes. Returns
   * the nonce string or null.
   *
   * The popup has a richer path that injects MAIN-world script to read
   * the live globals (see src/popup/lib/actions.js → requestSiteInfo);
   * this is the content-script-side fallback that handles the common
   * case of WP-emitted inline config.
   */
  function findNonceInDocument(doc) {
    if (!doc || !doc.querySelectorAll) return null;

    // wpApiSettings / _wpApiSettings inline object literal. The pattern
    // tolerates whitespace differences but assumes nonce is a hex string
    // (output of wp_create_nonce) and appears as a top-level key.
    const scripts = doc.querySelectorAll('script:not([src])');
    for (let i = 0; i < scripts.length; i++) {
      const t = scripts[i].textContent || '';
      const m = t.match(/(?:wpApiSettings|_wpApiSettings)\s*=\s*\{[^}]*"nonce"\s*:\s*"([a-f0-9]+)"/);
      if (m) return m[1];
      const m2 = t.match(/wp\.api\.fetch\.use\(\s*wp\.api\.fetch\.createNonceMiddleware\(\s*"([a-f0-9]+)"/);
      if (m2) return m2[1];
    }

    // Gutenberg + some plugins emit the nonce on a root element.
    const el = doc.querySelector('[data-rest-nonce], [data-wp-nonce], [data-nonce]');
    if (el) {
      return el.getAttribute('data-rest-nonce')
        || el.getAttribute('data-wp-nonce')
        || el.getAttribute('data-nonce')
        || null;
    }
    return null;
  }

  /**
   * Same-origin + /wp-admin/ guard for URLs sourced from page DOM. Used
   * to validate hrefs extracted from the admin bar before the popup
   * navigates to them — a compromised or hostile page can construct a
   * fake admin bar with off-origin links that the toolbar would
   * otherwise carry forward as if they were trusted.
   */
  function isSameOriginAdminUrl(href, origin) {
    if (!href || !origin) return false;
    try {
      const u = new URL(href);
      return u.origin === origin && /^\/wp-admin\//.test(u.pathname);
    } catch (_) {
      return false;
    }
  }

  async function fetchTermId({ restApiRoot, origin, taxonomy, slug, fetchImpl = fetch }) {
    if (!taxonomy || !slug) return null;
    const root = normalizeRoot(restApiRoot, origin);
    const base = TAX_REST_BASE[taxonomy] || taxonomy;
    const url  = `${root}wp/v2/${encodeURIComponent(base)}?slug=${encodeURIComponent(slug)}`;
    try {
      const res = await fetchImpl(url, { credentials: 'include' });
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return null;
      return data[0].id || null;
    } catch (_) {
      return null;
    }
  }

  async function fetchAuthorId({ restApiRoot, origin, slug, fetchImpl = fetch }) {
    if (!slug) return null;
    const root = normalizeRoot(restApiRoot, origin);
    const url  = `${root}wp/v2/users?slug=${encodeURIComponent(slug)}`;
    try {
      const res = await fetchImpl(url, { credentials: 'include' });
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return null;
      return data[0].id || null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Given a detection context, returns an edit URL or null. Async path
   * only — call resolveEditUrlSync first and fall back to this when it
   * returns null AND the context has slugs that need resolving.
   */
  async function resolveEditUrlAsync(ctx, origin, fetchImpl = fetch) {
    // Term archive without a numeric ID — resolve via REST.
    if (ctx.pageType === 'term' && ctx.taxonomy && !ctx.termId && ctx.term) {
      const id = await fetchTermId({
        restApiRoot: ctx.restApiRoot, origin,
        taxonomy: ctx.taxonomy, slug: ctx.term, fetchImpl,
      });
      if (id) {
        return `${origin}/wp-admin/term.php?taxonomy=${encodeURIComponent(ctx.taxonomy)}&tag_ID=${id}`;
      }
    }

    // Author archive without a numeric ID — resolve via REST.
    if (ctx.pageType === 'author' && !ctx.authorId && ctx.authorSlug) {
      const id = await fetchAuthorId({
        restApiRoot: ctx.restApiRoot, origin,
        slug: ctx.authorSlug, fetchImpl,
      });
      if (id) {
        return `${origin}/wp-admin/user-edit.php?user_id=${id}`;
      }
    }

    return null;
  }

  /**
   * Sync-only resolution — no network. Returns the best admin URL given
   * whatever IDs we already have in context, or null.
   */
  function isSameOrigin(href, origin) {
    try { return new URL(href).origin === origin; } catch (_) { return false; }
  }

  function resolveEditUrlSync(ctx, origin) {
    if (ctx.adminBarEditHref && isSameOrigin(ctx.adminBarEditHref, origin)) {
      return ctx.adminBarEditHref;
    }

    // Single post / page / CPT
    if (ctx.postId && ctx.pageType === 'single') {
      return `${origin}/wp-admin/post.php?post=${ctx.postId}&action=edit`;
    }

    // Term archive — ID already in context
    if (ctx.pageType === 'term' && ctx.taxonomy && ctx.termId) {
      return `${origin}/wp-admin/term.php?taxonomy=${encodeURIComponent(ctx.taxonomy)}&tag_ID=${ctx.termId}`;
    }

    // Author archive — ID already in context
    if (ctx.pageType === 'author' && ctx.authorId) {
      return `${origin}/wp-admin/user-edit.php?user_id=${ctx.authorId}`;
    }

    return null;
  }

  /**
   * True when sync resolution failed but we have enough context for a
   * REST round-trip to succeed. Popup uses this to decide whether to
   * show a "resolving…" state vs. a flat "coming soon".
   */
  function canResolveViaRest(ctx) {
    if (ctx.pageType === 'term' && ctx.taxonomy && !ctx.termId && ctx.term) return true;
    if (ctx.pageType === 'author' && !ctx.authorId && ctx.authorSlug) return true;
    return false;
  }

  /**
   * Public site-info endpoint (/wp-json/). Returns name, description, url,
   * home, gmt_offset, timezone_string, namespaces, site_logo, site_icon_url.
   * Works without authentication — most useful fact is `namespaces`, which
   * reveals plugins that register their own REST routes (wc/v3, yoast/v1,
   * contact-form-7/v1, etc.) even when DOM scanning misses them.
   */
  async function fetchSiteInfo({ restApiRoot, origin, nonce, fetchImpl = fetch }) {
    const root = normalizeRoot(restApiRoot, origin);
    try {
      const res = await fetchImpl(root, {
        credentials: 'include',
        headers: nonce ? { 'X-WP-Nonce': nonce } : undefined,
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  /**
   * Active theme — requires edit_theme_options capability (admins have it).
   * The collection endpoint returns an array; `?status=active` filters to
   * the one currently serving the site. Returns the first entry or null.
   */
  async function fetchActiveTheme({ restApiRoot, origin, nonce, fetchImpl = fetch }) {
    const root = normalizeRoot(restApiRoot, origin);
    try {
      const res = await fetchImpl(`${root}wp/v2/themes?status=active`, {
        credentials: 'include',
        headers: nonce ? { 'X-WP-Nonce': nonce } : undefined,
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return null;
      return data[0];
    } catch (_) {
      return null;
    }
  }

  /**
   * Full plugin list — requires activate_plugins capability (admins have it).
   * Returns an array of plugin objects with { plugin, name, version, author,
   * status, plugin_uri, ... } or null when unauthorized / REST is disabled.
   */
  async function fetchPluginsDetail({ restApiRoot, origin, nonce, fetchImpl = fetch }) {
    const root = normalizeRoot(restApiRoot, origin);
    try {
      const res = await fetchImpl(`${root}wp/v2/plugins`, {
        credentials: 'include',
        headers: nonce ? { 'X-WP-Nonce': nonce } : undefined,
      });
      if (!res.ok) return null;
      const data = await res.json();
      return Array.isArray(data) ? data : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Raw post content — requires the user to be able to edit the given post
   * (WP returns 401 otherwise). Returns the content string with block
   * comments intact, or null on any failure. Used by the block inspector
   * to recover full namespaced names, metadata.name labels, and
   * template-part slugs that the frontend HTML doesn't carry.
   *
   * Tries the well-known REST base first and falls back to the /types
   * endpoint for custom post types.
   */
  async function fetchRawContent({ restApiRoot, origin, postType, postId, nonce, fetchImpl = fetch }) {
    if (!postId) return null;
    const root = normalizeRoot(restApiRoot, origin);
    // `?context=edit` requires `edit_post` capability; WP rejects cookie
    // auth without X-WP-Nonce even when the user is authenticated.
    const headers = nonce ? { 'X-WP-Nonce': nonce } : undefined;

    const COMMON = {
      post: 'posts',
      page: 'pages',
      attachment: 'media',
    };
    let base = COMMON[postType] || null;

    if (!base && postType) {
      try {
        // /types is publicly readable; nonce not required, but pass it
        // along when we have one — costs nothing.
        const res = await fetchImpl(
          `${root}wp/v2/types/${encodeURIComponent(postType)}`,
          { credentials: 'include', headers },
        );
        if (res.ok) {
          const info = await res.json();
          if (info && info.rest_base) base = info.rest_base;
        }
      } catch (_) { /* fall through */ }
    }
    if (!base) return null;

    try {
      const res = await fetchImpl(
        `${root}wp/v2/${encodeURIComponent(base)}/${encodeURIComponent(postId)}?context=edit`,
        { credentials: 'include', headers },
      );
      if (!res.ok) return null;
      const data = await res.json();
      return (data && data.content && data.content.raw) || null;
    } catch (_) {
      return null;
    }
  }

  globalThis.WPRest = {
    fetchTermId,
    fetchAuthorId,
    resolveEditUrlSync,
    resolveEditUrlAsync,
    canResolveViaRest,
    fetchSiteInfo,
    fetchActiveTheme,
    fetchPluginsDetail,
    fetchRawContent,
    findNonceInDocument,
    isSameOriginAdminUrl,
  };
})();
