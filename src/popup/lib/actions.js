/**
 * Chrome tab/cookie side effects for the popup action rows. Each action
 * computes a target URL (if any) and either navigates the active tab,
 * opens a new tab, or performs an ambient side effect (clear data,
 * open mobile preview, etc.).
 */

export async function runAction(action, { origin, url, editUrl, viewUrl, logoutUrl, newTab = false }) {
	let target;
	switch (action) {
		case 'edit':
			target = editUrl || null;
			break;
		case 'view-post':
			target = viewUrl || null;
			break;
		case 'visit-site':
			target = `${origin}/`;
			break;
		case 'admin':
			target = `${origin}/wp-admin/`;
			break;
		case 'profile':
			target = `${origin}/wp-admin/profile.php`;
			break;
		case 'login':
			target = `${origin}/wp-login.php`;
			break;
		case 'login-return':
			target = `${origin}/wp-login.php?redirect_to=${encodeURIComponent(url)}`;
			break;
		// Prefer the admin bar's logout link — it carries the `_wpnonce` that
		// makes WP skip its "are you sure?" confirmation. (We do our own
		// inline confirm, so WP's would be a redundant second click.) Falls
		// back to the bare URL when the admin bar wasn't on the page.
		case 'signout':
			target = logoutUrl || `${origin}/wp-login.php?action=logout`;
			break;
		case 'cachebust': {
			const bust = Math.random().toString(36).slice(2, 7);
			const u = new URL(url);
			u.searchParams.set('cachebust', bust);
			target = u.toString();
			break;
		}
		case 'mobile-preview':
			// Popup window sized to match an iPhone 16/17 Pro (393 × 852).
			// Chrome's popup type adds ~60px of chrome (title bar + URL bar),
			// so the actual viewport is slightly shorter — close enough for a
			// responsive preview without the window looking oversized.
			await chrome.windows.create({ url, type: 'popup', width: 393, height: 852 });
			window.close();
			return;
		case 'clear-data':
			await clearSiteData(origin);
			return;
	}
	if (!target) return;
	if (newTab) {
		await chrome.tabs.create({ url: target });
	} else {
		await chrome.tabs.update({ url: target });
	}
	window.close();
}

export async function copyToClipboard(text) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch (_) {
		return false;
	}
}

const WP_COOKIE_PATTERNS = [/^wordpress_/, /^wp-settings-/, /^wp_/];
const isWpCookie = (name) => WP_COOKIE_PATTERNS.some((re) => re.test(name));

async function clearSiteData(origin) {
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
				try { localStorage.clear(); } catch (_) { /* ignore */ }
				try { sessionStorage.clear(); } catch (_) { /* ignore */ }
			},
		});
	} catch (_) {
		/* content script unreachable */
	}

	// 3. Reload the page so the clean state takes effect.
	await chrome.tabs.reload(tab.id);
	window.close();
}

export async function applyAdminBarPref(hidden) {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	try {
		await chrome.tabs.sendMessage(tab.id, {
			type: 'APPLY_ADMIN_BAR_PREF',
			hidden,
		});
	} catch (_) {
		/* content script gone — next load will pick it up */
	}
}

export async function applyBlockInspectorPref(enabled) {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	try {
		await chrome.tabs.sendMessage(tab.id, {
			type: 'APPLY_BLOCK_INSPECTOR',
			enabled,
		});
	} catch (_) {
		/* content script gone — next load will pick it up */
	}
}

export async function requestRestEditUrl() {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		const res = await chrome.tabs.sendMessage(tab.id, { type: 'RESOLVE_EDIT_URL_REST' });
		return res && res.url ? res.url : null;
	} catch (_) {
		return null;
	}
}

export async function requestSiteInfo() {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		// WP's authenticated REST endpoints require X-WP-Nonce even with
		// cookies. The nonce lives in several places depending on which
		// scripts WP enqueued on the page; we look in all of them. Has to
		// run in MAIN world — content scripts can't see page globals.
		let nonce = null;
		try {
			const [out] = await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				world: 'MAIN',
				func: () => {
					if (window.wpApiSettings?.nonce) return window.wpApiSettings.nonce;
					if (window._wpApiSettings?.nonce) return window._wpApiSettings.nonce;
					if (window.wp?.apiFetch?.nonceMiddleware?.nonce) return window.wp.apiFetch.nonceMiddleware.nonce;
					// Inline script content — many WP setups print the nonce
					// in a script tag without exposing it on a global.
					for (const s of document.querySelectorAll('script:not([src])')) {
						const t = s.textContent || '';
						const m = t.match(/(?:wpApiSettings|_wpApiSettings)\s*=\s*\{[^}]*"nonce"\s*:\s*"([a-f0-9]+)"/)
							|| t.match(/wp\.api\.fetch\.use\(\s*wp\.api\.fetch\.createNonceMiddleware\(\s*"([a-f0-9]+)"/);
						if (m) return m[1];
					}
					// data-* attribute scan — Gutenberg + some plugins emit
					// `data-rest-nonce`/`data-wp-nonce` on root elements.
					const el = document.querySelector('[data-rest-nonce], [data-wp-nonce], [data-nonce]');
					return el?.getAttribute('data-rest-nonce')
						|| el?.getAttribute('data-wp-nonce')
						|| el?.getAttribute('data-nonce')
						|| null;
				},
			});
			nonce = out?.result || null;
		} catch (_) { /* page disallows scripting */ }

		// If the current page didn't expose a nonce, fetch /wp-admin/profile.php
		// — admin pages reliably enqueue wp-api so the inline script with the
		// nonce is in the response. Lighter than the full dashboard.
		if (!nonce) {
			try {
				const origin = new URL(tab.url).origin;
				const res = await fetch(`${origin}/wp-admin/profile.php`, {
					credentials: 'include',
					redirect: 'follow',
				});
				if (res.ok) {
					const html = await res.text();
					const m = html.match(/(?:wpApiSettings|_wpApiSettings)\s*=\s*\{[^}]*"nonce"\s*:\s*"([a-f0-9]+)"/);
					if (m) nonce = m[1];
				}
			} catch (_) { /* admin fetch failed — give up, will pass null */ }
		}
		const res = await chrome.tabs.sendMessage(tab.id, { type: 'GET_SITE_INFO', nonce });
		return res || null;
	} catch (_) {
		return null;
	}
}

export async function toggleQueryMonitor() {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_QUERY_MONITOR' });
	} catch (_) {
		/* content script unreachable — nothing to toggle */
	}
}
