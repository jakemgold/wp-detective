/**
 * WP Detective — background service worker
 *
 * Responsibilities:
 *   - Cache per-origin detection results in chrome.storage.local
 *   - Refresh cached entries no more than once per REFRESH_INTERVAL
 *   - Purge origins unvisited for longer than PURGE_AFTER
 *   - Update the toolbar icon to reflect WP detection per tab
 *   - Serve cached detection to the popup
 */

const CACHE_KEY = 'wp_detection_cache_v1';
const REFRESH_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 1 week
const PURGE_AFTER      = 28 * 24 * 60 * 60 * 1000; // 4 weeks

// --- Cache helpers --------------------------------------------------------

async function getCache() {
  const data = await chrome.storage.local.get(CACHE_KEY);
  return data[CACHE_KEY] || {};
}

async function writeCache(cache) {
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

async function getEntry(origin) {
  const cache = await getCache();
  return cache[origin] || null;
}

async function upsertEntry(origin, entry) {
  const cache = await getCache();
  cache[origin] = entry;
  await writeCache(cache);
}

async function purgeStale() {
  const cache = await getCache();
  const now = Date.now();
  let changed = false;
  for (const origin of Object.keys(cache)) {
    const entry = cache[origin];
    if (!entry || !entry.lastSeen || now - entry.lastSeen > PURGE_AFTER) {
      delete cache[origin];
      changed = true;
    }
  }
  if (changed) await writeCache(cache);
}

// --- Detection handling ---------------------------------------------------

chrome.runtime.onStartup.addListener(purgeStale);
chrome.runtime.onInstalled.addListener(purgeStale);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !sender.tab) return;

  if (msg.type === 'WP_DETECTION') {
    handleDetection(msg, sender).then(() => sendResponse({ ok: true }));
    return true; // keep channel open for async response
  }

  if (msg.type === 'GET_CACHED_DETECTION') {
    getEntry(msg.origin).then(sendResponse);
    return true;
  }
});

async function handleDetection(msg, sender) {
  const { origin, detection } = msg;
  const now = Date.now();
  const existing = await getEntry(origin);

  // Decide whether to trust this detection or the cache.
  // - If the current page strongly suggests WP, use it.
  // - If not, keep the cached answer (the home page may have different
  //   signals than a deep page; headless WP setups especially).
  const freshlyDetected = detection.isWordPress;
  const cacheIsFresh = existing &&
                       existing.isWordPress &&
                       (now - existing.checkedAt) < REFRESH_INTERVAL;

  const entry = {
    origin,
    isWordPress: freshlyDetected || cacheIsFresh || false,
    confidence: Math.max(
      detection.confidence,
      existing ? existing.confidence : 0,
    ),
    signals: detection.signals,
    // Only advance checkedAt when we have a confident positive detection,
    // so a single ambiguous page view doesn't reset the clock.
    checkedAt: freshlyDetected
      ? now
      : (existing?.checkedAt || now),
    lastSeen: now,
  };

  await upsertEntry(origin, entry);
  await updateToolbar(sender.tab.id, entry.isWordPress, detection.context);
}

// --- Toolbar icon + title -------------------------------------------------

async function updateToolbar(tabId, isWordPress, context) {
  // Distinct icons signal the active/inactive state. Until icons exist,
  // the setIcon call throws; we swallow and fall back to the title.
  try {
    await chrome.action.setIcon({
      tabId,
      path: {
        16: `icons/icon-16${isWordPress ? '-active' : ''}.png`,
        32: `icons/icon-32${isWordPress ? '-active' : ''}.png`,
      },
    });
  } catch (_) { /* icons not shipped yet */ }

  const title = isWordPress
    ? `WordPress detected${context?.isLoggedIn ? ' — logged in' : ''}`
    : 'WP Detective';
  try {
    await chrome.action.setTitle({ tabId, title });
  } catch (_) { /* tab may have closed */ }
}

// Re-check cache when a tab changes URL, so the icon reflects cached state
// even before the content script reports in.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== 'loading') return;
  if (!tab.url || !/^https?:/.test(tab.url)) return;

  try {
    const origin = new URL(tab.url).origin;
    const entry = await getEntry(origin);
    if (entry) await updateToolbar(tabId, entry.isWordPress, {});
  } catch (_) { /* invalid URL */ }
});
