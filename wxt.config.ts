import { defineConfig } from 'wxt';
import { resolve } from 'path';

export default defineConfig({
  srcDir: 'src',
  modules: [],
  manifest: (env) => {
    const isFirefox = env.browser === 'firefox';
    return {
      name: 'CrossBrowserBookmarkSync',
      description:
        'Cross-browser bookmark sync supporting S3 and WebDAV storage backends',
      version: '0.2.0',
      icons: {
        16: 'icon-16.png',
        32: 'icon-32.png',
        48: 'icon-48.png',
        128: 'icon-128.png',
      },
      // Firefox (MV2) needs the host permission declared STATICALLY: permissions
      // granted at runtime via optional_permissions + permissions.request() do not
      // reliably disable CORS for background requests (both fetch and XHR stay
      // blocked even though permissions.contains() reports true). A static host
      // permission engages Firefox's CORS bypass correctly.
      // Chrome (MV3) uses optional_host_permissions granted on demand, which works.
      permissions: isFirefox
        ? ['bookmarks', 'storage', 'alarms', '*://*/*']
        : ['bookmarks', 'storage', 'alarms'],
      ...(env.manifestVersion === 3
        ? { optional_host_permissions: ['*://*/*'] }
        : {}),
    };
  },
  vite: () => ({
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    build: {
      target: 'esnext',
    },
  }),
});
