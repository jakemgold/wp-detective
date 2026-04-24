import { useState } from 'react';
import { Collapsible, Icon } from '@wordpress/ui';
import { chevronDown, plugins, cog } from '@wordpress/icons';
import { ActionRow } from './ActionRow';

/**
 * Surfaces admin-bar items contributed by plugins that we haven't wired up
 * explicitly. The tree structure from the admin bar is preserved — parent
 * items with submenus render as nested collapsibles, leaves as action rows.
 */
export function PluginActions({ items = [], onOpen }) {
	const [open, setOpen] = useState(false);
	if (!items.length) return null;

	return (
		<Collapsible.Root open={open} onOpenChange={setOpen} className="wpd-plugins">
			<Collapsible.Trigger className="wpd-plugins__trigger">
				<span className="wpd-plugins__label-group">
					<Icon icon={plugins} size={16} />
					<span className="wpd-plugins__label">From plugins</span>
					<span className="wpd-plugins__count">{items.length}</span>
				</span>
				<span className={`wpd-plugins__chevron ${open ? 'is-open' : ''}`} aria-hidden="true">
					<Icon icon={chevronDown} size={14} />
				</span>
			</Collapsible.Trigger>
			<Collapsible.Panel className="wpd-plugins__panel">
				<div className="wpd-plugins__items">
					{items.map((item) => (
						<PluginMenuItem key={item.id} item={item} onOpen={onOpen} />
					))}
				</div>
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}

/**
 * Renders a single admin-bar node. Leaf items render as a card row; items
 * with children render as a nested collapsible group with an optional
 * "(label) — open" action at the top when the parent itself has an href.
 */
function PluginMenuItem({ item, onOpen }) {
	const [open, setOpen] = useState(false);

	if (!item.children?.length) {
		return (
			<ActionRow
				icon={cog}
				label={item.label}
				onClick={() => onOpen(item.href)}
				onNewTab={() => onOpen(item.href, true)}
			/>
		);
	}

	return (
		<Collapsible.Root open={open} onOpenChange={setOpen} className="wpd-plugin-group">
			<Collapsible.Trigger className="wpd-plugin-group__trigger">
				<span className="wpd-plugin-group__label-group">
					<Icon icon={cog} size={16} />
					<span className="wpd-plugin-group__label">{item.label}</span>
				</span>
				<span className={`wpd-plugin-group__chevron ${open ? 'is-open' : ''}`} aria-hidden="true">
					<Icon icon={chevronDown} size={12} />
				</span>
			</Collapsible.Trigger>
			<Collapsible.Panel className="wpd-plugin-group__panel">
				<div className="wpd-plugin-group__items">
					{item.href && (
						<ActionRow
							icon={cog}
							label={`Open ${item.label}`}
							onClick={() => onOpen(item.href)}
							onNewTab={() => onOpen(item.href, true)}
						/>
					)}
					{item.children.map((child) => (
						<PluginMenuItem key={child.id} item={child} onOpen={onOpen} />
					))}
				</div>
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}

