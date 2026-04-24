/**
 * WP Detective — block inspector
 *
 * Outlines every WordPress block on the page (identified by its
 * `wp-block-<name>` class) and shows a cursor-following tooltip with the
 * full nesting breadcrumb.
 *
 * DOM-based identification:
 *   - JS tags real blocks with `data-wpd-block="<name>"` and
 *     `data-wpd-block-ns="core"|"third-party"`.
 *   - A strict regex rejects BEM sub-classes (`wp-block-cover__inner-container`,
 *     `wp-block-foo--modifier`) so `closest()` lands on true block boundaries.
 *   - A MutationObserver keeps tags fresh for SPAs / lazy content.
 *
 * Optional REST enrichment (logged-in users only):
 *   - Fetches the post's raw content via /wp/v2/<base>/<id>?context=edit.
 *   - Parses block comments to recover full namespaced names
 *     (`core/paragraph` vs. just `paragraph`), block metadata.name
 *     (user-assigned labels in the editor), and template-part slugs.
 *   - Aligns the parsed block tree to the tagged DOM nodes in document order
 *     and attaches `data-wpd-block-full` / `data-wpd-block-label`.
 *
 * Tooltip truncation happens in the middle — the hovered block (the leaf)
 * is always shown, with `…` standing in for omitted ancestors.
 */
(function () {
  'use strict';

  const STYLE_ID = 'wpd-block-inspector-style';
  const TOOLTIP_ID = 'wpd-block-inspector-tooltip';
  const BLOCK_ATTR = 'data-wpd-block';
  const NS_ATTR = 'data-wpd-block-ns';
  const FULL_ATTR = 'data-wpd-block-full';
  const LABEL_ATTR = 'data-wpd-block-label';

  const STYLES = `
    [${BLOCK_ATTR}] {
      outline: 1px dashed rgba(56, 88, 233, 0.55) !important;
      outline-offset: -1px !important;
    }
    [${BLOCK_ATTR}][${NS_ATTR}="third-party"] {
      outline-color: rgba(214, 112, 20, 0.65) !important;
    }
    #${TOOLTIP_ID} {
      position: fixed;
      z-index: 2147483646;
      background: rgba(20, 22, 26, 0.95);
      color: #f6f3ec;
      font: 500 11px/1.45 ui-monospace, "SF Mono", Menlo, Monaco, monospace;
      padding: 6px 9px;
      border-radius: 4px;
      pointer-events: none;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
      max-width: min(480px, calc(100vw - 24px));
      white-space: nowrap;
      overflow: hidden;
      display: none;
    }
    #${TOOLTIP_ID} .wpd-bi__sep {
      color: #8e96a8;
      margin: 0 5px;
      opacity: 0.7;
    }
    #${TOOLTIP_ID} .wpd-bi__more {
      color: #8e96a8;
      opacity: 0.85;
    }
    #${TOOLTIP_ID} .wpd-bi__core { color: #8eb0ff; }
    #${TOOLTIP_ID} .wpd-bi__third { color: #f2a74b; }
    #${TOOLTIP_ID} .wpd-bi__leaf {
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    #${TOOLTIP_ID} .wpd-bi__name-label {
      color: #f6f3ec;
      opacity: 0.85;
      margin-left: 4px;
      font-style: italic;
    }
  `;

  // Valid block names after `wp-block-`: lowercase alphanumerics joined by
  // single dashes. Rejects BEM-style sub-classes (`foo__bar`, `foo--mod`).
  const BLOCK_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  // First segments that core itself uses for compound block names.
  // Anything else with a compound name is treated as third-party.
  const CORE_MULTIWORD_PREFIXES = new Set([
    'archives', 'avatar', 'buttons', 'categories', 'column', 'comment',
    'comments', 'cover', 'embed', 'group', 'home', 'latest', 'list',
    'login', 'media', 'navigation', 'page', 'post', 'query', 'read',
    'search', 'site', 'social', 'tag', 'template', 'term',
  ]);

  let tooltip = null;
  let lastTarget = null;
  let observer = null;
  let installed = false;
  let enrichmentDone = false;

  // ------------------------------------------------------------------ tagging

  function extractBlockName(el) {
    const cl = el.classList;
    for (let i = 0; i < cl.length; i++) {
      const cls = cl[i];
      if (cls === 'wp-block' || !cls.startsWith('wp-block-')) continue;
      const name = cls.slice('wp-block-'.length);
      if (BLOCK_NAME_RE.test(name)) return name;
    }
    return null;
  }

  function isThirdParty(name) {
    const dash = name.indexOf('-');
    if (dash === -1) return false;
    return !CORE_MULTIWORD_PREFIXES.has(name.slice(0, dash));
  }

  function tagElement(el) {
    const name = extractBlockName(el);
    if (!name) return;
    if (el.getAttribute(BLOCK_ATTR) === name) return;
    el.setAttribute(BLOCK_ATTR, name);
    el.setAttribute(NS_ATTR, isThirdParty(name) ? 'third-party' : 'core');
  }

  function tagSubtree(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.className && typeof root.className === 'string' &&
        /\bwp-block-/.test(root.className)) {
      tagElement(root);
    }
    if (root.querySelectorAll) {
      const candidates = root.querySelectorAll('[class*="wp-block-"]');
      for (let i = 0; i < candidates.length; i++) tagElement(candidates[i]);
    }
  }

  function untagAll() {
    const tagged = document.querySelectorAll(`[${BLOCK_ATTR}]`);
    for (let i = 0; i < tagged.length; i++) {
      tagged[i].removeAttribute(BLOCK_ATTR);
      tagged[i].removeAttribute(NS_ATTR);
      tagged[i].removeAttribute(FULL_ATTR);
      tagged[i].removeAttribute(LABEL_ATTR);
    }
  }

  // ---------------------------------------------------------------- rendering

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => (
      c === '&' ? '&amp;' :
      c === '<' ? '&lt;'  :
      c === '>' ? '&gt;'  :
      c === '"' ? '&quot;' : '&#39;'
    ));
  }

  function buildChain(target) {
    const chain = [];
    let el = target;
    while (el && el !== document.documentElement) {
      if (el.getAttribute) {
        const name = el.getAttribute(BLOCK_ATTR);
        if (name) {
          const full = el.getAttribute(FULL_ATTR);
          chain.unshift({
            display: full || name,
            label: el.getAttribute(LABEL_ATTR) || null,
            third: el.getAttribute(NS_ATTR) === 'third-party',
          });
        }
      }
      el = el.parentElement;
    }
    return chain;
  }

  function renderItem(item, isLeaf) {
    const cls = item.third ? 'wpd-bi__third' : 'wpd-bi__core';
    const leafCls = isLeaf ? ' wpd-bi__leaf' : '';
    const labelHtml = item.label
      ? `<span class="wpd-bi__name-label">"${escapeHtml(item.label)}"</span>`
      : '';
    return `<span class="${cls}${leafCls}">${escapeHtml(item.display)}</span>${labelHtml}`;
  }

  const SEP = '<span class="wpd-bi__sep">›</span>';
  const MORE = '<span class="wpd-bi__more">…</span>';

  function renderChainWindow(chain, head, tail) {
    const parts = [];
    const last = chain.length - 1;
    for (let i = 0; i < head; i++) parts.push(renderItem(chain[i], i === last));
    if (head + tail < chain.length) parts.push(MORE);
    for (let i = chain.length - tail; i < chain.length; i++) {
      parts.push(renderItem(chain[i], i === last));
    }
    return parts.join(SEP);
  }

  function fitAndRender(chain, el) {
    // Try full breadcrumb first. When it fits, done.
    el.innerHTML = renderChainWindow(chain, chain.length, 0);
    if (chain.length <= 2 || el.scrollWidth <= el.clientWidth + 1) return;

    // Overflow — collapse the middle. Bias toward the trailing side so the
    // leaf (the hovered block) always wins; the leftmost ancestor is kept
    // as context when possible.
    for (let total = chain.length - 1; total >= 1; total--) {
      const tail = Math.ceil(total / 2);
      const head = total - tail;
      el.innerHTML = renderChainWindow(chain, head, tail);
      if (el.scrollWidth <= el.clientWidth + 1) return;
    }
  }

  // ----------------------------------------------------------------- tooltip

  function ensureTooltip() {
    if (tooltip && tooltip.isConnected) return tooltip;
    tooltip = document.createElement('div');
    tooltip.id = TOOLTIP_ID;
    (document.body || document.documentElement).appendChild(tooltip);
    return tooltip;
  }

  function positionTooltip(x, y) {
    if (!tooltip) return;
    const pad = 14;
    const w = tooltip.offsetWidth;
    const h = tooltip.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x + pad;
    let top  = y + pad;
    if (left + w > vw - 4) left = Math.max(4, x - pad - w);
    if (top  + h > vh - 4) top  = Math.max(4, y - pad - h);
    tooltip.style.left = left + 'px';
    tooltip.style.top  = top  + 'px';
  }

  function hideTooltip() {
    if (tooltip) tooltip.style.display = 'none';
    lastTarget = null;
  }

  function rerenderCurrent() {
    if (!lastTarget || !tooltip) return;
    fitAndRender(buildChain(lastTarget), tooltip);
  }

  function onMouseMove(e) {
    const target = e.target && e.target.closest
      ? e.target.closest(`[${BLOCK_ATTR}]`)
      : null;
    if (!target) {
      hideTooltip();
      return;
    }
    ensureTooltip();
    if (target !== lastTarget) {
      fitAndRender(buildChain(target), tooltip);
      lastTarget = target;
    }
    tooltip.style.display = 'block';
    positionTooltip(e.clientX, e.clientY);
  }

  function onMouseOut(e) {
    if (!e.relatedTarget && !e.toElement) hideTooltip();
  }

  function onScroll() {
    hideTooltip();
  }

  // ---------------------------------------------------------------- observer

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.type === 'childList') {
          for (let j = 0; j < m.addedNodes.length; j++) tagSubtree(m.addedNodes[j]);
        } else if (m.type === 'attributes' && m.target && m.target.nodeType === 1) {
          const name = extractBlockName(m.target);
          if (name) tagElement(m.target);
          else if (m.target.hasAttribute(BLOCK_ATTR)) {
            m.target.removeAttribute(BLOCK_ATTR);
            m.target.removeAttribute(NS_ATTR);
            m.target.removeAttribute(FULL_ATTR);
            m.target.removeAttribute(LABEL_ATTR);
          }
        }
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  // -------------------------------------------------------- REST enrichment

  // Matches both paired and self-closing block comments. Attrs are an
  // optional JSON object captured with a non-greedy pattern; the `s` flag
  // lets it span newlines.
  const BLOCK_COMMENT_RE =
    /<!--\s+(\/)?wp:([a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)?)\s*(\{[\s\S]*?\})?\s*(\/)?\s*-->/g;

  function parseBlockComments(html) {
    const root = { children: [] };
    const stack = [root];
    let m;
    BLOCK_COMMENT_RE.lastIndex = 0;
    while ((m = BLOCK_COMMENT_RE.exec(html)) !== null) {
      const [, close, name, attrsJson, self] = m;
      if (close) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      let attrs = {};
      if (attrsJson) {
        try { attrs = JSON.parse(attrsJson); } catch (_) { /* malformed */ }
      }
      const fullName = name.includes('/') ? name : `core/${name}`;
      const block = { name: fullName, attrs, children: [] };
      stack[stack.length - 1].children.push(block);
      if (!self) stack.push(block);
    }
    return root.children;
  }

  function flattenBlocks(blocks, out) {
    const list = out || [];
    for (let i = 0; i < blocks.length; i++) {
      list.push(blocks[i]);
      flattenBlocks(blocks[i].children, list);
    }
    return list;
  }

  /**
   * Converts a full block name to the class stem WordPress uses on the
   * frontend: `core/paragraph` → `paragraph`, `acf/testimonial` →
   * `acf-testimonial`, `core/post-title` → `post-title`.
   */
  function classStemFromBlockName(name) {
    const slash = name.indexOf('/');
    if (slash === -1) return name;
    const ns = name.slice(0, slash);
    const rest = name.slice(slash + 1);
    return ns === 'core' ? rest : `${ns}-${rest}`;
  }

  function labelForBlock(block) {
    const md = block.attrs && block.attrs.metadata;
    if (md && md.name) return md.name;
    if (block.name === 'core/template-part' && block.attrs && block.attrs.slug) {
      return `template part: ${block.attrs.slug}`;
    }
    if (block.name === 'core/block' && block.attrs && block.attrs.ref) {
      return `synced pattern #${block.attrs.ref}`;
    }
    return null;
  }

  function alignBlocks(parsedFlat) {
    // Walk tagged DOM blocks in document order; for each, find the next
    // parsed block whose class stem matches. Parsed blocks that don't get
    // a frontend wrapper (classic paragraph/heading in older setups) are
    // skipped rather than claimed, so ordering stays aligned.
    const domBlocks = document.querySelectorAll(`[${BLOCK_ATTR}]`);
    let pi = 0;
    for (let i = 0; i < domBlocks.length; i++) {
      const el = domBlocks[i];
      const stem = el.getAttribute(BLOCK_ATTR);
      let found = -1;
      for (let j = pi; j < parsedFlat.length; j++) {
        if (classStemFromBlockName(parsedFlat[j].name) === stem) {
          found = j;
          break;
        }
      }
      if (found >= 0) {
        const pb = parsedFlat[found];
        el.setAttribute(FULL_ATTR, pb.name);
        const label = labelForBlock(pb);
        if (label) el.setAttribute(LABEL_ATTR, label);
        pi = found + 1;
      }
    }
  }

  async function enrichFromRest(options) {
    if (enrichmentDone) return;
    if (!options || !options.isLoggedIn || !options.postId) return;
    if (!globalThis.WPRest || !globalThis.WPRest.fetchRawContent) return;
    try {
      const raw = await globalThis.WPRest.fetchRawContent({
        restApiRoot: options.restApiRoot,
        origin: options.origin,
        postType: options.postType,
        postId: options.postId,
      });
      if (!raw) return;
      const tree = parseBlockComments(raw);
      if (tree.length === 0) return;
      alignBlocks(flattenBlocks(tree));
      enrichmentDone = true;
      // If the tooltip is currently shown, refresh its content so the new
      // labels appear immediately without waiting for the next hover.
      rerenderCurrent();
    } catch (_) {
      /* enrichment is best-effort */
    }
  }

  // ----------------------------------------------------------- enable/disable

  function enable(options) {
    if (installed) return;
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = STYLES;
      document.documentElement.appendChild(style);
    }
    tagSubtree(document.body);
    startObserver();
    document.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('mouseout', onMouseOut, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    installed = true;

    if (options) enrichFromRest(options);
  }

  function disable() {
    if (!installed) return;
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();
    stopObserver();
    untagAll();
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseout', onMouseOut);
    window.removeEventListener('scroll', onScroll, { capture: true });
    if (tooltip && tooltip.isConnected) tooltip.remove();
    tooltip = null;
    lastTarget = null;
    enrichmentDone = false;
    installed = false;
  }

  globalThis.WPDBlockInspector = {
    enable,
    disable,
    // Exposed for smoke tests.
    _parseBlockComments: parseBlockComments,
    _classStemFromBlockName: classStemFromBlockName,
  };
})();
