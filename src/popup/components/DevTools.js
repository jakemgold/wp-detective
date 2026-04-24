import { useEffect, useState } from 'react';
import { Collapsible, Icon } from '@wordpress/ui';
import { chevronDown, mobile, update, trash, search } from '@wordpress/icons';
import { ActionRow } from './ActionRow';
import { InlineConfirm } from './InlineConfirm';
import { runAction, toggleQueryMonitor } from '../lib/actions';

const OPEN_KEY = 'wp_devtools_open';

export function DevTools({ origin, url, hasQueryMonitor = false }) {
	const [open, setOpen] = useState(false);
	const [hydrated, setHydrated] = useState(false);

	useEffect(() => {
		chrome.storage.local.get(OPEN_KEY).then((data) => {
			if (data[OPEN_KEY]) setOpen(true);
			setHydrated(true);
		});
	}, []);

	const handleOpenChange = (next) => {
		setOpen(next);
		chrome.storage.local.set({ [OPEN_KEY]: next });
	};

	// Wait for the persisted open/closed state to load so the panel doesn't
	// flicker open-then-closed.
	if (!hydrated) return null;

	return (
		<Collapsible.Root open={open} onOpenChange={handleOpenChange} className="wpd-devtools">
			<Collapsible.Trigger className="wpd-devtools__trigger">
				<span className="wpd-devtools__label">Developer tools</span>
				<span className={`wpd-devtools__chevron ${open ? 'is-open' : ''}`} aria-hidden="true">
					<Icon icon={chevronDown} size={14} />
				</span>
			</Collapsible.Trigger>
			<Collapsible.Panel className="wpd-devtools__panel">
				<div className="wpd-devtools__items">
					<ActionRow
						icon={mobile}
						label="Preview mobile size"
						onClick={() => runAction('mobile-preview', { origin, url })}
					/>
					<ActionRow
						icon={update}
						label="Attempt uncached view"
						onClick={() => runAction('cachebust', { origin, url })}
					/>
					{hasQueryMonitor && (
						<ActionRow
							icon={search}
							label="Toggle Query Monitor"
							onClick={toggleQueryMonitor}
						/>
					)}
					<InlineConfirm
						icon={trash}
						label="Clear site data (keep WP login)"
						onConfirm={() => runAction('clear-data', { origin, url })}
						destructive
					/>
				</div>
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}
