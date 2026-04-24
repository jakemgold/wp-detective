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

function loadModules(dom) {
  const ctx = dom.window;
  // Both files are IIFEs that attach to globalThis. Binding the jsdom
  // window as globalThis lets them install WPDetect/WPRest there.
  new Function('globalThis', 'document', 'window', detectSrc)(ctx, ctx.document, ctx);
  new Function('globalThis', 'document', 'window', restSrc)(ctx, ctx.document, ctx);
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

  // --- 8. Not a WordPress site ------------------------------------------
  {
    console.log('\n[8] Non-WordPress page');
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
