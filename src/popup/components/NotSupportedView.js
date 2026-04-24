import { EmptyState } from '@wordpress/ui';
import { globe } from '@wordpress/icons';

export function NotSupportedView() {
	return (
		<EmptyState.Root className="wpd-empty">
			<EmptyState.Visual>
				<EmptyState.Icon icon={globe} />
			</EmptyState.Visual>
			<EmptyState.Title>Nothing to inspect here</EmptyState.Title>
			<EmptyState.Description>Open a website to get started.</EmptyState.Description>
		</EmptyState.Root>
	);
}
