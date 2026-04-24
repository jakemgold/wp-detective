import { EmptyState } from '@wordpress/ui';
import { info } from '@wordpress/icons';
import { Header } from './Header';

export function NotWordPressView({ hostname }) {
	return (
		<>
			<Header hostname={hostname} />
			<EmptyState.Root className="wpd-empty">
				<EmptyState.Visual>
					<EmptyState.Icon icon={info} />
				</EmptyState.Visual>
				<EmptyState.Title>Not a WordPress site</EmptyState.Title>
				<EmptyState.Description>No signals detected.</EmptyState.Description>
			</EmptyState.Root>
		</>
	);
}
