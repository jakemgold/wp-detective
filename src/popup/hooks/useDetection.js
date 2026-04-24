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

				setState({
					status: 'detected',
					result,
					host: cached?.host || null,
				});
			} catch (err) {
				console.error('WP Detective popup error:', err);
				if (!cancelled) setState({ status: 'error' });
			}
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	return state;
}
