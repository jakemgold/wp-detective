import { EmptyState } from '@wordpress/ui';
import { error } from '@wordpress/icons';

export function ErrorView() {
	return (
		<EmptyState.Root className="wpd-empty">
			<EmptyState.Visual>
				<EmptyState.Icon icon={error} />
			</EmptyState.Visual>
			<EmptyState.Title>Something went wrong</EmptyState.Title>
			<EmptyState.Description>Check the service-worker logs.</EmptyState.Description>
		</EmptyState.Root>
	);
}
