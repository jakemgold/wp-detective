import { useCallback, useEffect, useState } from 'react';

const PREFS_KEY = 'wp_preferences_v1';
const DEFAULT_PREFS = { adminBarHidden: true, blockInspectorEnabled: false };

export function usePrefs(origin) {
	const [prefs, setPrefs] = useState(DEFAULT_PREFS);

	useEffect(() => {
		if (!origin) return;
		(async () => {
			const data = await chrome.storage.local.get(PREFS_KEY);
			const all = data[PREFS_KEY] || {};
			setPrefs({ ...DEFAULT_PREFS, ...(all[origin] || {}) });
		})();
	}, [origin]);

	const savePref = useCallback(
		async (key, value) => {
			setPrefs((prev) => ({ ...prev, [key]: value }));
			const data = await chrome.storage.local.get(PREFS_KEY);
			const all = data[PREFS_KEY] || {};
			all[origin] = { ...DEFAULT_PREFS, ...(all[origin] || {}), [key]: value };
			await chrome.storage.local.set({ [PREFS_KEY]: all });
		},
		[origin],
	);

	return [prefs, savePref];
}
