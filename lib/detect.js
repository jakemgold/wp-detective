/**
 * WordPress Browser Extension — detection module
 *
 * Pure functions that inspect a Document and return WordPress detection
 * signals and page context. No browser APIs are called here so this
 * module is unit-testable in Node with jsdom.
 *
 * Loaded as a content script before content.js, so it attaches its API
 * to globalThis.WPDetect rather than using ES module exports (content
 * scripts in MV3 do not share a module graph).
 */
(function () {
  'use strict';

  // Confidence thresholds — tune with real-world data.
  const CONFIDENCE_THRESHOLD = 40;
  const MAX_ASSETS_TO_SCAN = 200;

  /**
   * Main entry point. Given a Document, returns:
   *   {
   *     isWordPress: boolean,
   *     confidence: number (0-100),
   *     signals: string[],          // which checks matched
   *     context: { ... }            // page-level info for the popup
   *   }
   */
  function detectWordPress(doc) {
    const result = {
      isWordPress: false,
      confidence: 0,
      signals: [],
      context: {
        postId: null,
        postType: null,
        pageTemplate: null,
        taxonomy: null,
        term: null,          // slug
        termId: null,        // numeric ID when WP exposes it
        authorSlug: null,
        authorId: null,
        // 'single' | 'archive' | 'term' | 'home' | 'search' | '404' | 'author' | null
        pageType: null,
        postStatus: null,     // publish | draft | pending | future | private
        isLoggedIn: false,
        hasAdminBar: false,
        generatorVersion: null,
        restApiRoot: null,
        adminBarEditHref: null,
        adminBarViewHref: null,
        adminBarLogoutHref: null,  // includes _wpnonce — bypasses WP's logout confirm
        // Admin-bar status counts. Only populated when logged in and the
        // user has the relevant capability (WP renders the nodes conditionally).
        updateCount: null,     // core + theme + plugin updates aggregated by WP
        commentCount: null,    // pending comment moderation count
        // Items under the admin bar's "+ New" dropdown: typically Post/Page/
        // Media/User plus any public CPTs. Each { id, label, href }.
        newContentItems: [],
        // True when the Query Monitor plugin is active (identified by the
        // floating panel it injects even while hidden).
        hasQueryMonitor: false,
      },
    };

    // --- Strong signal: REST API discovery link (very hard to hide) ---
    const apiLink = doc.querySelector('link[rel="https://api.w.org/"]');
    if (apiLink && apiLink.href) {
      result.signals.push('rest-api-link');
      result.confidence += 60;
      result.context.restApiRoot = apiLink.href;
    }

    // --- Medium signal: generator meta tag ---
    const generator = doc.querySelector('meta[name="generator"]');
    if (generator && /WordPress/i.test(generator.content || '')) {
      result.signals.push('generator-meta');
      result.confidence += 40;
      const m = generator.content.match(/WordPress\s+([\d.]+)/i);
      if (m) result.context.generatorVersion = m[1];
    }

    // --- Medium signal: wp-content / wp-includes in asset URLs ---
    if (hasWordPressAssetPaths(doc)) {
      result.signals.push('wp-asset-path');
      result.confidence += 30;
    }

    // --- Strong signal: admin bar in DOM ---
    const adminBar = doc.getElementById('wpadminbar');
    if (adminBar) {
      result.signals.push('admin-bar-element');
      result.confidence += 40;
      result.context.hasAdminBar = true;
      result.context.isLoggedIn = true; // admin bar rendered = logged in

      const editLink = adminBar.querySelector('#wp-admin-bar-edit a[href]');
      if (editLink) result.context.adminBarEditHref = editLink.href;

      // Logout link carries the `_wpnonce` that lets us skip WP's "are you
      // sure?" confirmation page — same nonce the admin bar itself uses.
      const logoutLink = adminBar.querySelector('#wp-admin-bar-logout a[href]');
      if (logoutLink) result.context.adminBarLogoutHref = logoutLink.href;

      // View/Preview links — present on admin edit screens. WordPress
      // renders #wp-admin-bar-view for published posts (permalink) and
      // #wp-admin-bar-preview for drafts (includes the preview nonce).
      const viewLink = adminBar.querySelector('#wp-admin-bar-view a[href]');
      const previewLink = adminBar.querySelector('#wp-admin-bar-preview a[href]');
      if (viewLink) {
        result.context.adminBarViewHref = viewLink.href;
        result.context.postStatus = 'publish';
      } else if (previewLink) {
        result.context.adminBarViewHref = previewLink.href;
        result.context.postStatus = 'draft';
      }

      // Status counts. The <li> is only rendered when the user has the
      // capability *and* a count is available; `.ab-label` holds the
      // visible number. Anything non-numeric is ignored.
      result.context.updateCount  = countFromLabel(adminBar, '#wp-admin-bar-updates .ab-label');
      result.context.commentCount = countFromLabel(adminBar, '#wp-admin-bar-comments .ab-label');

      // "+ New" menu items. Each sub-item is a distinct content type the
      // current user can create — extract href + label so the popup can
      // mirror the admin bar menu without hard-coding which types exist.
      const newItems = adminBar.querySelectorAll('#wp-admin-bar-new-content .ab-submenu > li[id] > a[href]');
      result.context.newContentItems = Array.from(newItems)
        .map((a) => {
          const li = a.closest('li[id]');
          const id = li ? li.id.replace(/^wp-admin-bar-new-/, '') : '';
          const label = (a.textContent || '').trim();
          return id && label ? { id, label, href: a.href } : null;
        })
        .filter(Boolean);
    }

    // --- Body classes: cheap but rich context ---
    if (doc.body) {
      parseBodyClasses(doc.body.classList, result);
    }

    // --- Query Monitor plugin detection ---
    // The plugin always injects #query-monitor-main (hidden until toggled),
    // even when the admin bar is disabled. Presence of either is enough.
    if (doc.getElementById('query-monitor-main') ||
        doc.getElementById('wp-admin-bar-query-monitor')) {
      result.context.hasQueryMonitor = true;
    }

    result.confidence = Math.min(result.confidence, 100);
    result.isWordPress = result.confidence >= CONFIDENCE_THRESHOLD;

    return result;
  }

  function countFromLabel(adminBar, selector) {
    const el = adminBar.querySelector(selector);
    if (!el) return null;
    const n = parseInt((el.textContent || '').trim(), 10);
    return Number.isFinite(n) ? n : null;
  }

  function hasWordPressAssetPaths(doc) {
    const assets = doc.querySelectorAll('link[href], script[src], img[src]');
    const limit = Math.min(assets.length, MAX_ASSETS_TO_SCAN);
    for (let i = 0; i < limit; i++) {
      const el = assets[i];
      const url = el.getAttribute('href') || el.getAttribute('src') || '';
      if (/\/wp-(content|includes)\//.test(url)) return true;
    }
    return false;
  }

  function parseBodyClasses(classList, result) {    let sawWpClass = false;
    const ctx = result.context;

    for (const cls of classList) {
      // Auth / chrome signals
      if (cls === 'logged-in') { ctx.isLoggedIn = true; sawWpClass = true; }
      if (cls === 'admin-bar')  { ctx.hasAdminBar = true; sawWpClass = true; }

      // wp-login.php and wp-admin both ship `wp-core-ui`; wp-login.php also
      // adds `login`. Neither page emits the REST link or generator meta
      // (those come from wp_head), so without these we'd fall below the
      // detection threshold on the login screen.
      if (cls === 'login' || cls === 'wp-core-ui') sawWpClass = true;

      // Post IDs
      let m;
      if ((m = cls.match(/^postid-(\d+)$/))) {
        ctx.postId = parseInt(m[1], 10);
        ctx.pageType = 'single';
        sawWpClass = true;
      } else if ((m = cls.match(/^page-id-(\d+)$/))) {
        ctx.postId = parseInt(m[1], 10);
        ctx.pageType = 'single';
        ctx.postType = 'page';
        sawWpClass = true;
      }

      // Page template (block themes use this less, but classic themes rely on it)
      if ((m = cls.match(/^page-template-(.+)$/)) && m[1] !== 'default') {
        ctx.pageTemplate = m[1];
        sawWpClass = true;
      }

      // single-<posttype> — WP writes the whole post-type slug verbatim
      // (including any hyphens in the slug, e.g. `single-case-study`).
      // Skip single-format-* (post formats like single-format-standard).
      if (cls.startsWith('single-') && cls.length > 7 && !cls.startsWith('single-format-')) {
        const slug = cls.slice(7);
        if (slug && !/^\d+$/.test(slug) && !ctx.postType) {
          ctx.postType = slug;
          ctx.pageType = 'single';
          sawWpClass = true;
        }
      } else if (cls === 'single' && !ctx.pageType) {
        ctx.pageType = 'single';
        sawWpClass = true;
      }

      // Term archives. WP emits both slug and numeric-ID classes, e.g.
      // `category`, `category-news`, `category-42` — we capture both when
      // present so sync resolution can skip the REST round-trip.
      if ((m = cls.match(/^tax-([a-z0-9_-]+)$/i))) {
        ctx.taxonomy = m[1];
        ctx.pageType = 'term';
        sawWpClass = true;
      }
      if ((m = cls.match(/^term-(.+)$/))) {
        absorbTermIdOrSlug(ctx, m[1]);
        sawWpClass = true;
      }
      if (cls === 'category' || cls.startsWith('category-')) {
        ctx.taxonomy = 'category';
        ctx.pageType = 'term';
        if (cls !== 'category') absorbTermIdOrSlug(ctx, cls.slice('category-'.length));
        sawWpClass = true;
      }
      if (cls === 'tag' || cls.startsWith('tag-')) {
        ctx.taxonomy = 'post_tag';
        ctx.pageType = 'term';
        if (cls !== 'tag') absorbTermIdOrSlug(ctx, cls.slice('tag-'.length));
        sawWpClass = true;
      }

      // Post type archive
      if ((m = cls.match(/^post-type-archive-(.+)$/))) {
        ctx.pageType = 'archive';
        ctx.postType = m[1];
        sawWpClass = true;
      } else if (cls === 'archive' && !ctx.pageType) {
        ctx.pageType = 'archive';
        sawWpClass = true;
      }

      // WordPress admin pages include post-type-{slug} (without "archive")
      // when editing a specific post type. Negative lookahead avoids
      // matching the front-end post-type-archive-{slug} handled above.
      if (!ctx.postType && (m = cls.match(/^post-type-(?!archive-)(.+)$/))) {
        ctx.postType = m[1];
        sawWpClass = true;
      }

      // Other page types — only set if we haven't already identified one
      if ((cls === 'home' || cls === 'front-page') && !ctx.pageType) {
        ctx.pageType = 'home';
        sawWpClass = true;
      }
      if ((cls === 'search' || cls.startsWith('search-')) && !ctx.pageType) {
        ctx.pageType = 'search';
        sawWpClass = true;
      }
      if (cls === 'error404') {
        ctx.pageType = '404';
        sawWpClass = true;
      }
      // Author archives: `author`, `author-<slug>`, `author-<id>`, plus
      // pagination helpers like `author-paged-2` which we ignore.
      if (cls === 'author' || cls.startsWith('author-')) {
        if (!ctx.pageType) ctx.pageType = 'author';
        if (cls.startsWith('author-')) {
          const rest = cls.slice('author-'.length);
          if (/^\d+$/.test(rest)) {
            ctx.authorId = parseInt(rest, 10);
          } else if (!rest.startsWith('paged')) {
            ctx.authorSlug = rest;
          }
        }
        sawWpClass = true;
      }
    }

    if (sawWpClass) {
      result.signals.push('wp-body-classes');
      result.confidence += 20;
    }
  }

  /**
   * Body classes that look like `category-X` or `term-X` can be either
   * the term's slug or its numeric ID — WP emits both. Numeric wins
   * because the ID is what the admin URL needs.
   */
  function absorbTermIdOrSlug(ctx, rest) {
    if (/^\d+$/.test(rest)) {
      ctx.termId = parseInt(rest, 10);
    } else if (!rest.startsWith('paged')) {
      ctx.term = rest;
    }
  }

  /**
   * Checks a cookie string (document.cookie format) for the WordPress
   * logged-in cookie. Used as a fallback when the admin bar has been
   * hidden by a plugin or theme.
   */
  function detectLoggedInFromCookies(cookieString) {
    if (!cookieString) return false;
    // wordpress_logged_in_<hash> is HttpOnly by default in modern WP, so
    // this rarely fires — kept for hardened-down installs where the cookie
    // is reachable from JS. wp-settings-<id> is deliberately NOT checked:
    // WP sets it with a 1-year expiry and never clears it on logout, so
    // it produces persistent false positives on any previously logged-in site.
    return /wordpress_logged_in_[a-f0-9]+=/.test(cookieString);
  }

  // Expose to content script
  globalThis.WPDetect = {
    detectWordPress,
    detectLoggedInFromCookies,
  };
})();
