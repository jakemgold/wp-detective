import { Badge } from '@wordpress/ui';
import { update, postComments } from '@wordpress/icons';
import { HostBadge } from './HostBadge';
import { StatusBadge } from './StatusBadge';

export function Header({
	hostname,
	host = null,
	wpVersion = null,
	loggedIn = false,
	origin = null,
	updateCount = null,
	commentCount = null,
	onOpen,
}) {
	const hasStatus = (updateCount && updateCount > 0) || (commentCount && commentCount > 0);
	const showMeta = host || wpVersion || loggedIn;
	return (
		<header className="wpd-header">
			<h1 className="wpd-header__title" title={hostname}>
				{hostname}
			</h1>
			{showMeta && (
				<div className="wpd-header__meta">
					{host && <HostBadge host={host} />}
					{wpVersion && <Badge intent="none">WordPress {wpVersion}</Badge>}
					{loggedIn && <Badge intent="informational">Logged in</Badge>}
				</div>
			)}
			{hasStatus && origin && (
				<div className="wpd-header__status">
					{updateCount > 0 && (
						<StatusBadge
							icon={update}
							label={`${updateCount} ${updateCount === 1 ? 'update' : 'updates'}`}
							intent="medium"
							onClick={() => onOpen?.(`${origin}/wp-admin/update-core.php`)}
						/>
					)}
					{commentCount > 0 && (
						<StatusBadge
							icon={postComments}
							label={`${commentCount} pending ${commentCount === 1 ? 'comment' : 'comments'}`}
							intent="informational"
							onClick={() =>
								onOpen?.(`${origin}/wp-admin/edit-comments.php?comment_status=moderated`)
							}
						/>
					)}
				</div>
			)}
		</header>
	);
}
