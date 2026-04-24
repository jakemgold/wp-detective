import { Badge, Icon } from '@wordpress/ui';
import { wordpress } from '@wordpress/icons';

// Brand-flavored identity marks. Simple monograms with each provider's
// primary color — avoids using copyrighted logos while still giving each
// host a recognizable visual anchor.
const HOST_MARKS = {
	wpengine: { letter: 'W', bg: '#002329', fg: '#0ecad4' },
	pantheon: { letter: 'P', bg: '#efd01b', fg: '#000' },
	kinsta: { letter: 'K', bg: '#5333ed', fg: '#fff' },
	flywheel: { letter: 'F', bg: '#f16521', fg: '#fff' },
	cloudways: { letter: 'C', bg: '#006fff', fg: '#fff' },
	pressable: { letter: 'P', bg: '#1d1d1d', fg: '#fff' },
	local: { letter: 'L', bg: '#6b7280', fg: '#fff' },
};

// Automattic-family providers reuse the WordPress mark.
const WP_MARK_HOSTS = new Set(['wpcom', 'wpvip']);

const HOST_NAMES = {
	wpcom: 'WordPress.com',
	wpvip: 'WordPress VIP',
	wpengine: 'WP Engine',
	pantheon: 'Pantheon',
	pressable: 'Pressable',
	kinsta: 'Kinsta',
	flywheel: 'Flywheel',
	cloudways: 'Cloudways',
	local: 'Local Dev',
};

export function HostBadge({ host }) {
	const name = HOST_NAMES[host] || host;

	if (WP_MARK_HOSTS.has(host)) {
		return (
			<Badge intent="none" className="wpd-host-badge">
				<span className="wpd-host-badge__mark wpd-host-badge__mark--wp" aria-hidden="true">
					<Icon icon={wordpress} size={14} />
				</span>
				{name}
			</Badge>
		);
	}

	const mark = HOST_MARKS[host];
	if (!mark) {
		return <Badge intent="none">{name}</Badge>;
	}

	return (
		<Badge intent="none" className="wpd-host-badge">
			<span
				className="wpd-host-badge__mark"
				style={{ background: mark.bg, color: mark.fg }}
				aria-hidden="true"
			>
				{mark.letter}
			</span>
			{name}
		</Badge>
	);
}
