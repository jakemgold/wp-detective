import { useMemo, useState } from 'react';
import { Collapsible, Icon } from '@wordpress/ui';
import { chevronDown, info as infoIcon, external } from '@wordpress/icons';
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

	const hasAnything =
		!!themeInfo || pluginRows.length > 0 || !!siteInfo?.name || !!siteInfo?.description;

	if (!hasAnything && !ctx.restApiRoot) return null;

	return (
		<Collapsible.Root open={open} onOpenChange={handleOpenChange} className="wpd-siteinfo">
			<Collapsible.Trigger className="wpd-siteinfo__trigger">
				<span className="wpd-siteinfo__label-group">
					<Icon icon={infoIcon} size={16} />
					<span className="wpd-siteinfo__label">Site info</span>
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
					{siteInfo && (siteInfo.name || siteInfo.description) && (
						<SiteSummary siteInfo={siteInfo} />
					)}

					{themeInfo && (
						<InfoGroup label="Active theme">
							<ThemeCard theme={themeInfo} origin={origin} onOpen={onOpen} />
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
							{pluginRows.map((p) => (
								<PluginRow key={p.slug} plugin={p} origin={origin} onOpen={onOpen} />
							))}
							{!loading && attempted && !plugins && pluginRows.length > 0 && (
								<p className="wpd-siteinfo__hint">
									Sign in as an admin to see plugin names and versions.
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

function SiteSummary({ siteInfo }) {
	return (
		<div className="wpd-siteinfo__summary">
			{siteInfo.name && <div className="wpd-siteinfo__site-name">{siteInfo.name}</div>}
			{siteInfo.description && (
				<div className="wpd-siteinfo__site-desc">{siteInfo.description}</div>
			)}
		</div>
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

function ThemeCard({ theme, origin, onOpen }) {
	const editHref = `${origin}/wp-admin/themes.php`;
	return (
		<div className="wpd-siteinfo__row">
			<div className="wpd-siteinfo__row-main">
				<div className="wpd-siteinfo__row-title">
					{theme.name}
					{theme.version && (
						<span className="wpd-siteinfo__row-version">{theme.version}</span>
					)}
				</div>
				<div className="wpd-siteinfo__row-sub">
					{theme.slug && <code>{theme.slug}</code>}
					{theme.author && <span>by {stripTags(theme.author)}</span>}
				</div>
			</div>
			<button
				type="button"
				className="wpd-siteinfo__row-aux"
				onClick={() => onOpen(editHref, true)}
				title="Open Themes"
				aria-label="Open Themes"
			>
				<Icon icon={external} size={14} />
			</button>
		</div>
	);
}

function PluginRow({ plugin, origin, onOpen }) {
	const hasDetail = !!plugin.name && plugin.name !== plugin.slug;
	const editHref = `${origin}/wp-admin/plugins.php`;
	return (
		<div className="wpd-siteinfo__row">
			<div className="wpd-siteinfo__row-main">
				<div className="wpd-siteinfo__row-title">
					{plugin.name || plugin.slug}
					{plugin.version && (
						<span className="wpd-siteinfo__row-version">{plugin.version}</span>
					)}
					{plugin.active === false && (
						<span className="wpd-siteinfo__row-tag">inactive</span>
					)}
				</div>
				{hasDetail && <div className="wpd-siteinfo__row-sub"><code>{plugin.slug}</code></div>}
			</div>
			<button
				type="button"
				className="wpd-siteinfo__row-aux"
				onClick={() => onOpen(editHref, true)}
				title="Open Plugins"
				aria-label="Open Plugins"
			>
				<Icon icon={external} size={14} />
			</button>
		</div>
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
		bySlug.set(slug, { slug, name: null, version: null, active: null });
	}

	// Namespaces give one extra signal — drop core wp/v2, oembed/1.0 noise.
	const NS_SKIP = new Set(['wp/v2', 'wp/v2/fields', 'wp-site-health/v1', 'oembed/1.0', 'wp-block-editor/v1', 'akismet/v1']);
	for (const ns of namespaces || []) {
		if (NS_SKIP.has(ns)) continue;
		const slugFromNs = ns.split('/')[0];
		if (!slugFromNs || slugFromNs === 'wp') continue;
		if (!bySlug.has(slugFromNs)) {
			bySlug.set(slugFromNs, { slug: slugFromNs, name: null, version: null, active: null });
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
		};
		bySlug.set(slug, row);
	}

	return Array.from(bySlug.values()).sort((a, b) => a.slug.localeCompare(b.slug));
}

function stripTags(s) {
	if (typeof s !== 'string') return '';
	return s.replace(/<[^>]*>/g, '').trim();
}
