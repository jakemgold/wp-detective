/**
 * WP Detective — REST API helpers
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

  globalThis.WPRest = {
    fetchTermId,
    fetchAuthorId,
    resolveEditUrlSync,
    resolveEditUrlAsync,
    canResolveViaRest,
  };
})();
