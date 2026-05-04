/**
 * Development preview — renders every popup state side-by-side against canned
 * fixtures so we can visually iterate without loading the extension in Chrome.
 * Not shipped in the extension; built as a separate entry point.
 */
import { createRoot } from 'react-dom/client';
import { DetectedView } from './components/DetectedView';
import { NotWordPressView } from './components/NotWordPressView';
import { NotSupportedView } from './components/NotSupportedView';
import { LoadingView } from './components/LoadingView';
import './popup.scss';

// Shim the content-script globals the popup reads from window.
window.WPRest = {
	resolveEditUrlSync: (ctx, origin) =>
		ctx.postId ? `${origin}/wp-admin/post.php?post=${ctx.postId}&action=edit` : null,
	canResolveViaRest: (ctx) => !!ctx.postSlug,
};
window.WPHost = {
	HOST_NAMES: { wpengine: 'WP Engine', pantheon: 'Pantheon' },
};

// Minimal chrome.* shim so usePrefs / useEffect-driven handlers don't crash.
window.chrome = {
	tabs: {
		query: async () => [{ id: 1, url: 'https://example.test/' }],
		sendMessage: async () => ({}),
	},
	runtime: { sendMessage: async () => null },
	storage: { local: { get: async () => ({}), set: async () => {} } },
};

const fixtures = [
	{
		id: 'logged-in',
		label: 'Logged in · front-end',
		render: () => (
			<DetectedView
				host="wpengine"
				result={{
					url: 'https://myblog.test/hello-world/',
					origin: 'https://myblog.test',
					detection: {
						isWordPress: true,
						context: {
							isLoggedIn: true,
							hasAdminBar: true,
							postId: 42,
							postType: 'post',
							pageType: 'single',
							generatorVersion: '6.4.2',
							updateCount: 3,
							commentCount: 2,
							hasQueryMonitor: true,
							newContentItems: [
								{ id: 'post', label: 'Post', href: 'https://myblog.test/wp-admin/post-new.php' },
								{ id: 'page', label: 'Page', href: 'https://myblog.test/wp-admin/post-new.php?post_type=page' },
								{ id: 'media', label: 'Media', href: 'https://myblog.test/wp-admin/media-new.php' },
								{ id: 'user', label: 'User', href: 'https://myblog.test/wp-admin/user-new.php' },
								{ id: 'product', label: 'Product', href: 'https://myblog.test/wp-admin/post-new.php?post_type=product' },
							],
						},
					},
				}}
			/>
		),
	},
	{
		id: 'wp-admin',
		label: 'Logged in · wp-admin editor',
		render: () => (
			<DetectedView
				host="pantheon"
				result={{
					url: 'https://myblog.test/wp-admin/post.php?post=42&action=edit',
					origin: 'https://myblog.test',
					detection: {
						isWordPress: true,
						context: {
							isLoggedIn: true,
							hasAdminBar: true,
							postId: 42,
							postType: 'post',
							postStatus: 'publish',
							adminBarViewHref: 'https://myblog.test/hello-world/',
							generatorVersion: '6.4.2',
						},
					},
				}}
			/>
		),
	},
	{
		id: 'logged-out',
		label: 'Logged out',
		render: () => (
			<DetectedView
				host={null}
				result={{
					url: 'https://wordpress.example/',
					origin: 'https://wordpress.example',
					detection: {
						isWordPress: true,
						context: { isLoggedIn: false, generatorVersion: '6.3.1' },
					},
				}}
			/>
		),
	},
	{
		id: 'admin-bar-disabled',
		label: 'Admin bar disabled in profile',
		render: () => (
			<DetectedView
				host="wpengine"
				result={{
					url: 'https://myblog.test/about/',
					origin: 'https://myblog.test',
					detection: {
						isWordPress: true,
						context: {
							isLoggedIn: true,
							hasAdminBar: false,
							postId: 1,
							postType: 'page',
							generatorVersion: '6.4.2',
						},
					},
				}}
			/>
		),
	},
	{
		id: 'not-wp',
		label: 'Not WordPress',
		render: () => <NotWordPressView hostname="news.example.com" />,
	},
	{
		id: 'unsupported',
		label: 'Chrome internal page',
		render: () => <NotSupportedView />,
	},
	{
		id: 'loading',
		label: 'Loading',
		render: () => <LoadingView />,
	},
];

const board = document.getElementById('board');
for (const fx of fixtures) {
	const cell = document.createElement('div');
	cell.className = 'preview-cell';
	cell.innerHTML = `
		<div class="preview-label">${fx.label}</div>
		<div class="preview-frame"></div>
	`;
	board.appendChild(cell);
	createRoot(cell.querySelector('.preview-frame')).render(fx.render());
}
