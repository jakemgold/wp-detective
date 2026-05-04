import { useMemo, useState } from 'react';
import { Collapsible, Icon } from '@wordpress/ui';
import { chevronDown, info as infoIcon } from '@wordpress/icons';
import { requestSiteInfo } from '../lib/actions';

/**
 * Surfaces whatever metadata we can gather about the site: active theme,
 * installed plugins, site name/description, REST namespaces.
 *
 * Rendered progressively — DOM-detected slugs appear immediately when the
 * panel opens; the REST round-trip (fired lazily on first open) then fills
 * in human-readable names, versions, and any extras only the REST API
 * exposes. The REST call can return partial data: site info is public,
 * theme/plugin detail require admin capabilities.
 */
export function SiteInfoPanel({ ctx, origin, onOpen }) {
	const [open, setOpen] = useState(false);
	const [data, setData] = useState(null);
	const [loading, setLoading] = useState(false);
	const [attempted, setAttempted] = useState(false);

	const themeSlug = ctx.themeSlug || null;
	const pluginSlugs = useMemo(() => ctx.pluginSlugs || [], [ctx.pluginSlugs]);

	const handleOpenChange = (next) => {
		setOpen(next);
		if (next && !attempted && !loading) {
			setLoading(true);
			requestSiteInfo().then((res) => {
				setData(res);
				setLoading(false);
				setAttempted(true);
			});
		}
	};

	const activeTheme = data?.activeTheme || null;
	const plugins = data?.plugins || null;
	const siteInfo = data?.siteInfo || null;

	// Merge DOM-detected plugin slugs with REST data when available.
	// REST is the richer source but needs admin capability, so the DOM list
	// is the fallback that still works for logged-out visitors.
	const pluginRows = useMemo(
		() => mergePlugins(pluginSlugs, plugins, siteInfo?.namespaces),
		[pluginSlugs, plugins, siteInfo],
	);

	const themeInfo = useMemo(
		() => mergeTheme(themeSlug, activeTheme),
		[themeSlug, activeTheme],
	);

	const hasAnything = !!themeInfo || pluginRows.length > 0;

	if (!hasAnything && !ctx.restApiRoot) return null;

	return (
		<Collapsible.Root open={open} onOpenChange={handleOpenChange} className="wpd-siteinfo">
			<Collapsible.Trigger className="wpd-siteinfo__trigger">
				<span className="wpd-siteinfo__label-group">
					<Icon icon={infoIcon} size={16} />
					<span className="wpd-siteinfo__label">Site Information</span>
				</span>
				<span
					className={`wpd-siteinfo__chevron ${open ? 'is-open' : ''}`}
					aria-hidden="true"
				>
					<Icon icon={chevronDown} size={14} />
				</span>
			</Collapsible.Trigger>
			<Collapsible.Panel className="wpd-siteinfo__panel">
				<div className="wpd-siteinfo__body">
					{themeInfo && (
						<InfoGroup label="Active theme">
							<ThemeRow theme={themeInfo} origin={origin} onOpen={onOpen} />
						</InfoGroup>
					)}

					{(pluginRows.length > 0 || loading) && (
						<InfoGroup
							label={
								plugins
									? `Plugins (${pluginRows.length})`
									: pluginRows.length
										? `Detected plugins (${pluginRows.length})`
										: 'Plugins'
							}
						>
							{loading && pluginRows.length === 0 && (
								<p className="wpd-siteinfo__hint">Loading…</p>
							)}
							{pluginRows.length > 0 && (
								<div className="wpd-siteinfo__pills">
									{pluginRows.map((p) => (
										<PluginPill key={p.slug} plugin={p} onOpen={onOpen} />
									))}
								</div>
							)}
							{!loading && attempted && !plugins && pluginRows.length > 0 && (
								<p className="wpd-siteinfo__hint">
									Log in for a comprehensive list of plugins with additional information.
								</p>
							)}
						</InfoGroup>
					)}

					{!loading && attempted && !hasAnything && (
						<p className="wpd-siteinfo__hint">Nothing extra we could detect.</p>
					)}
				</div>
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}

function InfoGroup({ label, children }) {
	return (
		<div className="wpd-siteinfo__group">
			<div className="wpd-siteinfo__group-label">{label}</div>
			<div className="wpd-siteinfo__group-items">{children}</div>
		</div>
	);
}

function ThemeRow({ theme, origin, onOpen }) {
	// hasRestDetail correlates with admin login — the REST themes endpoint
	// requires edit_theme_options, which only admins have. So this is also
	// our signal for "is the row actionable."
	const hasRestDetail = !!(theme.version || theme.author);
	const tooltip = theme.version ? `${theme.name} ${theme.version}` : theme.name;
	const body = (
		<div className="wpd-siteinfo__row-main">
			<div className="wpd-siteinfo__row-title">
				{theme.name}
				{theme.version && (
					<span className="wpd-siteinfo__row-version">{theme.version}</span>
				)}
			</div>
			<div className="wpd-siteinfo__row-sub">
				{hasRestDetail ? (
					<>
						{theme.slug && <code>{theme.slug}</code>}
						{theme.author && <span>by {stripTags(theme.author)}</span>}
					</>
				) : (
					<span>Log in for additional information.</span>
				)}
			</div>
		</div>
	);
	if (!hasRestDetail) {
		// No useful destination when logged out — the row is informational.
		return <div className="wpd-siteinfo__row" title={tooltip}>{body}</div>;
	}
	// Admin: open the themes management page (browse, switch, configure).
	return (
		<button
			type="button"
			className="wpd-siteinfo__row wpd-siteinfo__row--button"
			onClick={() => onOpen(`${origin}/wp-admin/themes.php`, true)}
			title={tooltip}
		>
			{body}
		</button>
	);
}

function PluginPill({ plugin, onOpen }) {
	const label = plugin.name || plugin.slug;
	// Prefer the plugin's own homepage URL when REST gave us one. Otherwise
	// fall back to the wp.org plugin directory — works for hosted plugins
	// and 404s gracefully for premium/custom ones.
	const href = plugin.pluginUri || `https://wordpress.org/plugins/${plugin.slug}/`;
	const tooltip = plugin.version ? `${label} ${plugin.version}` : label;
	return (
		<button
			type="button"
			className="wpd-siteinfo__pill"
			onClick={() => onOpen(href, true)}
			title={tooltip}
		>
			{label}
		</button>
	);
}

/**
 * Combines the asset-scan theme slug with REST data when the user has
 * edit_theme_options. REST wins on every field it provides; the slug is
 * always shown so we can still say something when REST is inaccessible.
 */
function mergeTheme(slug, rest) {
	if (!slug && !rest) return null;
	if (!rest) return { slug, name: slug, version: null, author: null };
	return {
		slug: rest.stylesheet || slug,
		name: rest.name?.rendered || rest.name || slug,
		version: rest.version || null,
		author: rest.author?.rendered || rest.author || null,
	};
}

/**
 * Unions the DOM-detected plugin slugs with REST plugin data and namespace
 * hints. Each output row has { slug, name, version, active }. REST rows
 * carry the slug as the first segment of their `plugin` field
 * ("jetpack/jetpack" → "jetpack"). Namespaces (wc/v3, yoast/v1, …) only
 * give us a slug-like hint; treat them the same as DOM slugs.
 */
function mergePlugins(domSlugs, restPlugins, namespaces) {
	const bySlug = new Map();

	for (const slug of domSlugs) {
		bySlug.set(slug, { slug, name: null, version: null, active: null, pluginUri: null });
	}

	// Namespaces give one extra signal — drop core wp/v2, oembed/1.0 noise.
	const NS_SKIP = new Set(['wp/v2', 'wp/v2/fields', 'wp-site-health/v1', 'oembed/1.0', 'wp-block-editor/v1', 'akismet/v1']);
	for (const ns of namespaces || []) {
		if (NS_SKIP.has(ns)) continue;
		const slugFromNs = ns.split('/')[0];
		if (!slugFromNs || slugFromNs === 'wp') continue;
		if (!bySlug.has(slugFromNs)) {
			bySlug.set(slugFromNs, { slug: slugFromNs, name: null, version: null, active: null, pluginUri: null });
		}
	}

	for (const p of restPlugins || []) {
		const slug = (p.plugin || '').split('/')[0];
		if (!slug) continue;
		const row = {
			slug,
			name: p.name || null,
			version: p.version || null,
			active: p.status === 'active',
			pluginUri: p.plugin_uri || null,
		};
		bySlug.set(slug, row);
	}

	// Hide inactive plugins. DOM-detected slugs (active: null) and REST-active
	// rows pass through; REST-confirmed inactive rows are dropped.
	return Array.from(bySlug.values())
		.filter((p) => p.active !== false)
		.sort((a, b) => a.slug.localeCompare(b.slug));
}

function stripTags(s) {
	if (typeof s !== 'string') return '';
	return s.replace(/<[^>]*>/g, '').trim();
}
