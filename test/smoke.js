/**
 * Smoke tests for lib/detect.js and lib/rest.js.
 *
 * These modules are deliberately framework-free and do not call any
 * browser APIs, which means we can exercise them under jsdom without
 * launching a real browser or loading the extension.
 *
 *   cd test
 *   npm install        # first time: installs jsdom
 *   node smoke.js
 *
 * Extend this file as the detection logic grows. The patterns to copy:
 *
 *   - new detection signal   → add an assertion to an existing scenario
 *   - new page type           → add a new scenario with a fresh JSDOM
 *   - new REST endpoint       → add a scenario using a mock fetchImpl
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const detectSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'detect.js'), 'utf8');
const restSrc   = fs.readFileSync(path.join(__dirname, '..', 'lib', 'rest.js'),   'utf8');
const hostSrc   = fs.readFileSync(path.join(__dirname, '..', 'lib', 'host.js'),   'utf8');

function loadModules(dom) {
  const ctx = dom.window;
  // All files are IIFEs that attach to globalThis. Binding the jsdom
  // window as globalThis lets them install WPDetect/WPRest/WPHost there.
  new Function('globalThis', 'document', 'window', detectSrc)(ctx, ctx.document, ctx);
  new Function('globalThis', 'document', 'window', restSrc)(ctx, ctx.document, ctx);
  new Function('globalThis', 'document', 'window', hostSrc)(ctx, ctx.document, ctx);
  return ctx;
}

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
  else       {             console.log ('  ok  :', msg); }
}

async function main() {
  // --- 1. Category page with both slug and ID body classes --------------
  {
    console.log('\n[1] Category archive with id+slug body classes');
    const dom = new JSDOM(`
      <html><head>
        <link rel="https://api.w.org/" href="https://example.com/wp-json/">
        <meta name="generator" content="WordPress 6.4.2">
      </head><body class="archive category category-news category-42 logged-in admin-bar">
        <div id="wpadminbar"></div>
      </body></html>
    `);
    const ctx = loadModules(dom);
    const det = ctx.WPDetect.detectWordPress(ctx.document);
    assert(det.isWordPress, 'detects WordPress');
    assert(det.context.pageType === 'term', 'pageType=term');
    assert(det.context.taxonomy === 'category', 'taxonomy=category');
    assert(det.context.termId === 42, 'termId=42 captured from category-42');
    assert(det.context.term === 'news', 'term=news captured from category-news');
    assert(det.context.isLoggedIn === true, 'isLoggedIn=true');

    const url = ctx.WPRest.resolveEditUrlSync(det.context, 'https://example.com');
    assert(url === 'https://example.com/wp-admin/term.php?taxonomy=category&tag_ID=42',
      `sync edit URL = ${url}`);
    assert(ctx.WPRest.canResolveViaRest(det.context) === false,
      'canResolveViaRest=false (ID already present)');
  }

  // --- 2. Category page with ONLY slug (ID stripped by a theme) ---------
  {
    console.log('\n[2] Category archive missing the numeric ID class');
    const dom = new JSDOM(`
      <html><head>
        <link rel="https://api.w.org/" href="https://example.com/wp-json/">
      </head><body class="archive category category-news logged-in admin-bar"></body></html>
    `);
    const ctx = loadModules(dom);
    const det = ctx.WPDetect.detectWordPress(ctx.document);
    assert(det.context.term === 'news', 'slug captured');
    assert(det.context.termId == null, 'no ID captured');
    assert(ctx.WPRest.resolveEditUrlSync(det.context, 'https://example.com') === null,
      'sync resolution returns null');
    assert(ctx.WPRest.canResolveViaRest(det.context) === true,
      'canResolveViaRest=true — REST fallback applicable');
  }

  // --- 3. REST fetchTermId against a mocked endpoint --------------------
  {
    console.log('\n[3] REST fetchTermId against a mocked endpoint');
    const dom = new JSDOM(`<html><body></body></html>`);
    const ctx = loadModules(dom);

    const calls = [];
    const mockFetch = async (url) => {
      calls.push(url);
      return { ok: true, async json() { return [{ id: 42, slug: 'news' }]; } };
    };

    const id = await ctx.WPRest.fetchTermId({
      restApiRoot: 'https://example.com/wp-json/',
      origin: 'https://example.com',
      taxonomy: 'category',
      slug: 'news',
      fetchImpl: mockFetch,
    });
    assert(id === 42, `id=42 (got ${id})`);
    assert(calls[0] === 'https://example.com/wp-json/wp/v2/categories?slug=news',
      `URL used rest_base=categories: ${calls[0]}`);
  }

  // --- 4. resolveEditUrlAsync stitches term lookup into an admin URL ----
  {
    console.log('\n[4] resolveEditUrlAsync for a term with slug only');
    const dom = new JSDOM(`<html><body></body></html>`);
    const ctx = loadModules(dom);
    const mockFetch = async () => ({ ok: true, async json() { return [{ id: 99 }]; } });
    const url = await ctx.WPRest.resolveEditUrlAsync({
      pageType: 'term',
      taxonomy: 'category',
      term: 'news',
      termId: null,
      restApiRoot: 'https://example.com/wp-json/',
    }, 'https://example.com', mockFetch);
    assert(url === 'https://example.com/wp-admin/term.php?taxonomy=category&tag_ID=99',
      `async URL stitched: ${url}`);
  }

  // --- 5. Author archive with numeric ID class --------------------------
  {
    console.log('\n[5] Author archive with author-<id> class');
    const dom = new JSDOM(`
      <html><body class="author author-jake author-7 logged-in admin-bar archive"></body></html>
    `);
    const ctx = loadModules(dom);
    const det = ctx.WPDetect.detectWordPress(ctx.document);
    assert(det.context.pageType === 'author', 'pageType=author');
    assert(det.context.authorSlug === 'jake', 'authorSlug=jake');
    assert(det.context.authorId === 7, 'authorId=7');
    const url = ctx.WPRest.resolveEditUrlSync(det.context, 'https://example.com');
    assert(url === 'https://example.com/wp-admin/user-edit.php?user_id=7',
      `sync URL = ${url}`);
  }

  // --- 6. Singular post — post.php URL ----------------------------------
  {
    console.log('\n[6] Singular post with postid-NNN');
    const dom = new JSDOM(`
      <html><body class="single single-post postid-101 logged-in admin-bar"></body></html>
    `);
    const ctx = loadModules(dom);
    const det = ctx.WPDetect.detectWordPress(ctx.document);
    assert(det.context.postId === 101, 'postId=101');
    const url = ctx.WPRest.resolveEditUrlSync(det.context, 'https://example.com');
    assert(url === 'https://example.com/wp-admin/post.php?post=101&action=edit',
      `sync URL = ${url}`);
  }

  // --- 7. adminBarEditHref takes priority -------------------------------
  {
    console.log('\n[7] adminBarEditHref wins over synthesized URL');
    const dom = new JSDOM(`
      <html><body class="single single-post postid-101 logged-in admin-bar">
        <div id="wpadminbar">
          <div id="wp-admin-bar-edit">
            <a href="https://example.com/wp-admin/post.php?post=101&action=edit&lang=en">Edit</a>
          </div>
        </div>
      </body></html>
    `);
    const ctx = loadModules(dom);
    const det = ctx.WPDetect.detectWordPress(ctx.document);
    const url = ctx.WPRest.resolveEditUrlSync(det.context, 'https://example.com');
    assert(url && url.includes('lang=en'), 'resolver returns the admin bar href');
  }

  // --- 8. Cookie-based logged-in detection ----------------------------
  // wordpress_logged_in_<hash> is the only reliable JS-visible signal:
  // it's cleared on logout. wp-settings-* persists 1 year past logout so
  // it must NOT be treated as "logged in" — produced persistent false
  // positives previously.
  {
    console.log('\n[8] Cookie-based logged-in detection');
    const dom = new JSDOM(`<html><body></body></html>`);
    const ctx = loadModules(dom);
    const check = ctx.WPDetect.detectLoggedInFromCookies;
    assert(check('wordpress_logged_in_abc123=user%7C1234') === true,
      'wordpress_logged_in cookie → logged in');
    assert(check('wp-settings-1=a; wp-settings-time-1=123') === false,
      'wp-settings alone → NOT a logged-in signal');
    assert(check('other=x; wp-settings-42=val') === false,
      'wp-settings among others → NOT a logged-in signal');
    assert(check('some_other_cookie=value') === false,
      'unrelated cookie → not logged in');
    assert(check('') === false, 'empty string → not logged in');
    assert(check(null) === false, 'null → not logged in');
  }

  // --- 9. Host detection from DOM assets --------------------------------
  {
    console.log('\n[9] Host detection from DOM asset URLs');
    const dom = new JSDOM(`
      <html><head>
        <link rel="stylesheet" href="https://example.com/wp-content/themes/theme/style.css">
        <script src="https://example.com.wpenginepowered.com/wp-includes/js/jquery.js"></script>
      </head><body></body></html>
    `);
    const ctx = loadModules(dom);
    assert(ctx.WPHost.detectHostFromDOM(ctx.document) === 'wpengine',
      'WP Engine detected from .wpenginepowered.com asset');

    const dom2 = new JSDOM(`
      <html><head>
        <img src="https://example.files.wordpress.com/2024/01/photo.jpg">
      </head><body></body></html>
    `);
    const ctx2 = loadModules(dom2);
    assert(ctx2.WPHost.detectHostFromDOM(ctx2.document) === 'wpcom',
      'WordPress.com detected from .files.wordpress.com asset');

    const dom3 = new JSDOM(`
      <html><head>
        <link rel="stylesheet" href="/wp-content/themes/theme/style.css">
      </head><body></body></html>
    `);
    const ctx3 = loadModules(dom3);
    assert(ctx3.WPHost.detectHostFromDOM(ctx3.document) === null,
      'no host detected from generic WP assets');
  }

  // --- 10. Local dev detection from origin ------------------------------
  {
    console.log('\n[10] Local dev detection from origin');
    const dom = new JSDOM(`<html><body></body></html>`);
    const ctx = loadModules(dom);
    const check = ctx.WPHost.detectHostFromOrigin;
    assert(check('http://localhost:8080') === 'local', 'localhost with port');
    assert(check('http://127.0.0.1') === 'local', '127.0.0.1');
    assert(check('http://mysite.local') === 'local', '.local TLD');
    assert(check('http://mysite.test') === 'local', '.test TLD');
    assert(check('http://mysite.lndo.site') === 'local', 'Lando');
    assert(check('http://mysite.ddev.site') === 'local', 'DDEV');
    assert(check('https://fueled.com') === null, 'production domain');
  }

  // --- 11. Host detection from response headers -------------------------
  {
    console.log('\n[11] Host detection from response headers');
    const dom = new JSDOM(`<html><body></body></html>`);
    const ctx = loadModules(dom);
    const detect = ctx.WPHost.detectHostFromHeaders;

    // Simulate a Headers-like object with a get() method
    const makeHeaders = (obj) => ({ get: (k) => obj[k.toLowerCase()] ?? null });

    assert(detect(makeHeaders({ 'wpe-backend': 'apache' })) === 'wpengine',
      'WP Engine from wpe-backend header');
    assert(detect(makeHeaders({ 'x-pantheon-styx-hostname': 'endpoint123' })) === 'pantheon',
      'Pantheon from x-pantheon-styx-hostname header');
    assert(detect(makeHeaders({ 'x-kinsta-cache': 'HIT' })) === 'kinsta',
      'Kinsta from x-kinsta-cache header');
    assert(detect(makeHeaders({ 'x-powered-by': 'WordPress VIP <abc>' })) === 'wpvip',
      'VIP from x-powered-by header');
    assert(detect(makeHeaders({ 'x-powered-by': 'WordPress.com' })) === 'wpcom',
      'WordPress.com from x-powered-by header');
    assert(detect(makeHeaders({ 'server': 'nginx', 'x-cache': 'HIT' })) === null,
      'no host from generic nginx headers');
  }

  // --- 13. Theme + plugin slugs from asset paths ------------------------
  {
    console.log('\n[13] Theme + plugin slug extraction');
    const dom = new JSDOM(`
      <html><head>
        <link rel="https://api.w.org/" href="https://example.com/wp-json/">
        <link rel="stylesheet" href="/wp-content/themes/twentytwentyfour/style.css">
        <link rel="stylesheet" href="/wp-content/plugins/woocommerce/assets/css/woocommerce.css">
        <script src="/wp-content/plugins/akismet/akismet.js"></script>
        <script src="/wp-content/mu-plugins/vip-helpers/loader.js"></script>
        <script src="/wp-content/plugins/woocommerce/assets/js/cart.js"></script>
      </head><body></body></html>
    `);
    const ctx = loadModules(dom);
    const det = ctx.WPDetect.detectWordPress(ctx.document);
    assert(det.context.themeSlug === 'twentytwentyfour',
      `themeSlug=twentytwentyfour (got ${det.context.themeSlug})`);
    assert(det.context.pluginSlugs.length === 3,
      `3 plugin slugs (got ${det.context.pluginSlugs.length})`);
    assert(det.context.pluginSlugs.includes('woocommerce'),
      'woocommerce slug detected');
    assert(det.context.pluginSlugs.includes('akismet'),
      'akismet slug detected');
    assert(det.context.pluginSlugs.includes('vip-helpers'),
      'vip-helpers from mu-plugins');
    // De-dupe: woocommerce appears twice in the DOM but only once in slugs.
    const wc = det.context.pluginSlugs.filter((s) => s === 'woocommerce');
    assert(wc.length === 1, 'duplicates collapsed');
  }

  // --- 14. REST site-info helper returns parsed JSON --------------------
  {
    console.log('\n[14] REST site-info helper');
    const dom = new JSDOM(`<html><body></body></html>`);
    const ctx = loadModules(dom);

    const fakeFetch = async (url) => ({
      ok: true,
      json: async () => ({
        name: 'Example', description: 'Just an example',
        namespaces: ['wp/v2', 'wc/v3', 'yoast/v1'],
      }),
    });
    const out = await ctx.WPRest.fetchSiteInfo({
      restApiRoot: 'https://example.com/wp-json/',
      origin: 'https://example.com',
      fetchImpl: fakeFetch,
    });
    assert(out && out.name === 'Example', 'site name parsed');
    assert(out.namespaces.includes('wc/v3'), 'namespaces surfaced');

    const failFetch = async () => ({ ok: false, json: async () => ({}) });
    const none = await ctx.WPRest.fetchSiteInfo({
      restApiRoot: 'https://example.com/wp-json/',
      origin: 'https://example.com',
      fetchImpl: failFetch,
    });
    assert(none === null, 'returns null on !ok response');
  }

  // --- 12. Not a WordPress site -----------------------------------------
  {
    console.log('\n[12] Non-WordPress page');
    const dom = new JSDOM(`<html><head><title>Not WP</title></head><body>hello</body></html>`);
    const ctx = loadModules(dom);
    const det = ctx.WPDetect.detectWordPress(ctx.document);
    assert(det.isWordPress === false, 'isWordPress=false');
    assert(det.confidence === 0, 'confidence=0');
  }

  console.log(`\n${failures === 0 ? 'All tests passed.' : failures + ' failure(s).'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
