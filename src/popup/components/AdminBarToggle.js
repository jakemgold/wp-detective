import { Icon } from '@wordpress/ui';
import { seen } from '@wordpress/icons';

/**
 * "Show admin bar" toggle — rendered as a card-row to match the surrounding
 * action cards. @wordpress/ui doesn't ship a Switch yet, so the track/thumb
 * is hand-rolled using design-system color tokens.
 */
export function AdminBarToggle({ checked, onChange, label = 'Show admin bar' }) {
	return (
		<div className="wpd-card-row wpd-toggle-row">
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				className="wpd-card__main"
				onClick={() => onChange(!checked)}
			>
				<span className="wpd-card__icon" aria-hidden="true">
					<Icon icon={seen} size={20} />
				</span>
				<span className="wpd-card__label">{label}</span>
				<span className={`wpd-switch ${checked ? 'is-on' : ''}`} aria-hidden="true">
					<span className="wpd-switch__thumb" />
				</span>
			</button>
		</div>
	);
}
