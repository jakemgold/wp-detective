import { useDetection } from './hooks/useDetection';
import { LoadingView } from './components/LoadingView';
import { ErrorView } from './components/ErrorView';
import { NotSupportedView } from './components/NotSupportedView';
import { NotWordPressView } from './components/NotWordPressView';
import { DetectedView } from './components/DetectedView';

export function App() {
	const state = useDetection();

	if (state.status === 'loading') return <LoadingView />;
	if (state.status === 'error') return <ErrorView />;
	if (state.status === 'unsupported') return <NotSupportedView />;
	if (state.status === 'not-wordpress') return <NotWordPressView hostname={state.hostname} />;
	return <DetectedView result={state.result} host={state.host} />;
}
