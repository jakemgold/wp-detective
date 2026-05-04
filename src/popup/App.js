import { useEffect } from 'react';
import { useDetection } from './hooks/useDetection';
import { LoadingView } from './components/LoadingView';
import { ErrorView } from './components/ErrorView';
import { NotSupportedView } from './components/NotSupportedView';
import { NotWordPressView } from './components/NotWordPressView';
import { DetectedView } from './components/DetectedView';

export function App() {
	const state = useDetection();
	useScrollGapFix();

	if (state.status === 'loading') return <LoadingView />;
	if (state.status === 'error') return <ErrorView />;
	if (state.status === 'unsupported') return <NotSupportedView />;
	if (state.status === 'not-wordpress') return <NotWordPressView hostname={state.hostname} />;
	return <DetectedView result={state.result} host={state.host} />;
}

/**
 * Safari popup quirk: when an accordion expands past the popup viewport
 * the user scrolls, but on collapse Safari doesn't re-measure — the popup
 * window stays tall, leaving an empty band at the bottom with no way to
 * scroll back. Two-part fix:
 *   1. Pin the document height to the React root's measured height so
 *      the popup window tracks content shrinkage.
 *   2. Reset stuck scroll offsets if content now fits without overflow.
 * Chrome already auto-sizes popups correctly; the same code is a no-op
 * there (offsetHeight == clientHeight whenever it's stable).
 */
function useScrollGapFix() {
	useEffect(() => {
		const root = document.getElementById('root');
		const html = document.documentElement;
		const body = document.body;
		if (!root || !body || typeof ResizeObserver === 'undefined') return;
		const sync = () => {
			const h = root.offsetHeight;
			if (h <= 0) return;
			// Pin html and body height to content. Safari measures the popup
			// window against body's outer size; html alone wasn't enough.
			html.style.height = `${h}px`;
			body.style.height = `${h}px`;
			if (body.scrollTop > 0 && body.scrollHeight <= body.clientHeight) {
				body.scrollTop = 0;
			}
		};
		const obs = new ResizeObserver(sync);
		obs.observe(root);
		sync();
		return () => {
			obs.disconnect();
			html.style.height = '';
			body.style.height = '';
		};
	}, []);
}
