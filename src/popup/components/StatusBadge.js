import { Badge, Icon } from '@wordpress/ui';

/**
 * A compact count badge rendered next to the host/version badges. Clickable
 * when an `href` is provided; otherwise renders as a static badge.
 */
export function StatusBadge({ icon, label, intent = 'none', href, onClick }) {
	const content = (
		<Badge intent={intent} className="wpd-status-badge">
			{icon && (
				<span className="wpd-status-badge__icon" aria-hidden="true">
					<Icon icon={icon} size={12} />
				</span>
			)}
			{label}
		</Badge>
	);

	if (!href && !onClick) return content;

	return (
		<button type="button" className="wpd-status-badge-btn" onClick={onClick}>
			{content}
		</button>
	);
}
