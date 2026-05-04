import { useEffect, useState } from 'react';

/**
 * Resolves the popup's view state from the active tab:
 *   1. Ask the content script for live detection (freshest context).
 *   2. Always fetch cached entry from the background (it carries host info,
 *      which the content script doesn't have).
 *   3. Reconcile — live takes priority; cached fills in the gaps.
 */
export function useDetection() {
	const [state, setState] = useState({ status: 'loading' });

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

				if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
					if (!cancelled) setState({ status: 'unsupported' });
					return;
				}

				const url = new URL(tab.url);
				const origin = url.origin;

				let result = null;
				try {
					result = await chrome.tabs.sendMessage(tab.id, { type: 'GET_LIVE_DETECTION' });
				} catch (_) {
					/* content script unreachable */
				}

				const cached = await chrome.runtime.sendMessage({
					type: 'GET_CACHED_DETECTION',
					origin,
				});

				if (!result && cached && cached.isWordPress) {
					result = {
						url: tab.url,
						origin,
						pathname: url.pathname,
						detection: {
							isWordPress: true,
							confidence: cached.confidence,
							signals: cached.signals,
							context: {},
						},
					};
				}

				if (cancelled) return;

				if (!result || !result.detection.isWordPress) {
					setState({ status: 'not-wordpress', hostname: url.hostname });
					return;
				}

				// Direct DOM probe via chrome.scripting — runs fresh in the page
				// context, bypassing whatever content script happens to be loaded
				// (which may be orphaned post-extension-reload, holding a stale
				// captured detection from before the user logged in). Cheap: one
				// IPC, a few selector lookups. Authoritative for "is the admin bar
				// actually in this DOM right now?"
				try {
					const [out] = await chrome.scripting.executeScript({
						target: { tabId: tab.id },
						func: () => {
							const ab = document.getElementById('wpadminbar');
							const body = document.body;
							const bodyLoggedIn = body?.classList?.contains('logged-in') || false;
							const qmPanel = document.getElementById('query-monitor-main');
							// QM has two visible states: `qm-show` (full panel) and
							// `qm-peek` (mini bar at bottom). Either counts as "open."
							const qmOpen = !!qmPanel && (
								qmPanel.classList.contains('qm-show') ||
								qmPanel.classList.contains('qm-peek')
							);
							if (!ab) return {
								hasAdminBar: false,
								bodyLoggedIn,
								hasQueryMonitor: !!qmPanel,
								qmOpen,
							};
							const edit    = ab.querySelector('#wp-admin-bar-edit a[href]');
							const view    = ab.querySelector('#wp-admin-bar-view a[href]');
							const preview = ab.querySelector('#wp-admin-bar-preview a[href]');
							const logout  = ab.querySelector('#wp-admin-bar-logout a[href]');
							const newLinks = ab.querySelectorAll('#wp-admin-bar-new-content .ab-submenu > li[id] > a[href]');
							const newContentItems = Array.from(newLinks).map((a) => {
								const li = a.closest('li[id]');
								const id = li ? li.id.replace(/^wp-admin-bar-new-/, '') : '';
								const label = (a.textContent || '').trim();
								return id && label ? { id, label, href: a.href } : null;
							}).filter(Boolean);
							return {
								hasAdminBar: true,
								bodyLoggedIn,
								adminBarEditHref: edit?.href || null,
								adminBarViewHref: view?.href || preview?.href || null,
								adminBarLogoutHref: logout?.href || null,
								postStatus: view ? 'publish' : (preview ? 'draft' : null),
								newContentItems,
								hasQueryMonitor: !!qmPanel || !!ab.querySelector('#wp-admin-bar-query-monitor'),
								qmOpen,
							};
						},
					});
					const live = out?.result;
					if (live) {
						const lc = result.detection.context;
						// `bodyLoggedIn` reflects WP's `body.logged-in` body class —
						// i.e., the page render came from an authenticated request.
						// Distinct from `isLoggedIn`, which can be true via the
						// cookie API even when the page DOM is logged-out HTML.
						lc.bodyLoggedIn = !!live.bodyLoggedIn;
						if (live.hasAdminBar) {
							lc.hasAdminBar = true;
							lc.isLoggedIn = true;
							if (live.adminBarEditHref) lc.adminBarEditHref = live.adminBarEditHref;
							if (live.adminBarViewHref) lc.adminBarViewHref = live.adminBarViewHref;
							if (live.adminBarLogoutHref) lc.adminBarLogoutHref = live.adminBarLogoutHref;
							if (live.postStatus) lc.postStatus = live.postStatus;
							if (live.newContentItems?.length) lc.newContentItems = live.newContentItems;
							if (live.hasQueryMonitor) lc.hasQueryMonitor = true;
							lc.qmOpen = !!live.qmOpen;
						} else if (live.bodyLoggedIn) {
							lc.isLoggedIn = true;
						}
					}
				} catch (_) { /* page disallows scripting (chrome://, etc.) */ }

				// Cookie-API check — for cases where even the live DOM doesn't have
				// the admin bar (BFCache restore, page-cached HTML for a freshly
				// authenticated user). Reads the HttpOnly `wordpress_logged_in_<hash>`
				// cookie that document.cookie can't see.
				let loggedInByCookie = false;
				if (!result.detection.context.isLoggedIn) {
					try {
						const cookies = await chrome.cookies.getAll({ url: tab.url });
						if (cookies.some((c) => /^wordpress_logged_in_/.test(c.name))) {
							result.detection.context.isLoggedIn = true;
							loggedInByCookie = true;
						}
					} catch (_) { /* cookies permission unavailable */ }
				}

				if (cancelled) return;

				// Push the popup's final resolution back to the background so the
				// toolbar icon and cache reflect any login override that DOM-based
				// detection missed (cookie API). Fire-and-forget.
				chrome.runtime.sendMessage({
					type: 'POPUP_DETECTION_RESOLVED',
					origin,
					tabId: tab.id,
					isWordPress: true,
					isLoggedIn: !!result.detection.context.isLoggedIn,
				}).catch(() => {});

				// Render now with what we have. The fresh-fetch below can take
				// hundreds of ms (full HTTP fetch + HTML parse) and was previously
				// blocking this render — kicked off in the background instead so
				// the popup appears instantly.
				const host = cached?.host || null;
				setState({ status: 'detected', result, host });

				// Body class says logged-out but cookie says logged-in: the page
				// is BFCache-restored or page-cached HTML from a logged-out
				// request. Re-fetch with credentials and merge admin-bar-derived
				// fields (edit href, +New menu, sign-out nonce, etc.) so the
				// popup gets richer over time. We don't overwrite hasAdminBar —
				// the live DOM still lacks the bar.
				if (loggedInByCookie && !result.detection.context.hasAdminBar) {
					try {
						const fresh = await Promise.race([
							chrome.tabs.sendMessage(tab.id, { type: 'GET_FRESH_DETECTION' }),
							new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
						]);
						if (cancelled) return;
						const fc = fresh?.detection?.context;
						if (fc) {
							// Mutate-then-clone so React sees a new top-level object
							// and re-renders the popup with the merged context.
							const lc = result.detection.context;
							if (fc.adminBarEditHref) lc.adminBarEditHref = fc.adminBarEditHref;
							if (fc.adminBarViewHref) lc.adminBarViewHref = fc.adminBarViewHref;
							if (fc.adminBarLogoutHref) lc.adminBarLogoutHref = fc.adminBarLogoutHref;
							if (fc.postStatus) lc.postStatus = fc.postStatus;
							if (fc.updateCount != null) lc.updateCount = fc.updateCount;
							if (fc.commentCount != null) lc.commentCount = fc.commentCount;
							if (fc.newContentItems?.length) lc.newContentItems = fc.newContentItems;
							if (fc.hasQueryMonitor) lc.hasQueryMonitor = true;
							setState({ status: 'detected', result: { ...result }, host });
						}
					} catch (_) { /* fresh fetch failed; partial state retained */ }
				}
			} catch (err) {
				console.error('WordPress Browser Extension popup error:', err);
				if (!cancelled) setState({ status: 'error' });
			}
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	return state;
}
