import { Icon } from '@wordpress/ui';

/**
 * Generic on/off toggle styled as a card-row. @wordpress/ui doesn't ship a
 * Switch yet, so the track/thumb is hand-rolled from design-system tokens.
 */
export function ToggleRow({ icon, label, checked, onChange, disabled = false }) {
	return (
		<div className={`wpd-card-row wpd-toggle-row${disabled ? ' is-disabled' : ''}`}>
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				aria-disabled={disabled}
				disabled={disabled}
				className="wpd-card__main"
				onClick={() => !disabled && onChange?.(!checked)}
			>
				{icon && (
					<span className="wpd-card__icon" aria-hidden="true">
						<Icon icon={icon} size={20} />
					</span>
				)}
				<span className="wpd-card__label">{label}</span>
				<span className={`wpd-switch ${checked ? 'is-on' : ''}`} aria-hidden="true">
					<span className="wpd-switch__thumb" />
				</span>
			</button>
		</div>
	);
}
