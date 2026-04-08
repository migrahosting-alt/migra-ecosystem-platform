import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const appDir = fileURLToPath(new URL('.', import.meta.url));
const packageJson = JSON.parse(readFileSync(path.join(appDir, 'package.json'), 'utf8')) as {
  version?: string;
};

const appVersion = packageJson.version ?? '0.0.1';
const buildTime = new Date().toISOString();
const buildSha = (() => {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: appDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
})();
const releaseLabel = buildSha === 'dev' ? appVersion : `${appVersion}+${buildSha}`;

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      registerType: 'prompt',
      manifestFilename: 'site.webmanifest',
      includeAssets: ['migra-logo-48.png', 'migra-logo-192.png', 'migra-logo-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'MigraVoice Enterprise Softphone',
        short_name: 'MigraVoice',
        description: 'Enterprise-grade VoIP softphone with WebRTC calling, live transcription, and team communication tools.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f172a',
        theme_color: '#2563eb',
        categories: ['business', 'communication', 'productivity'],
        lang: 'en',
        dir: 'ltr',
        icons: [
          {
            src: 'migra-logo-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: 'migra-logo-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
        shortcuts: [
          {
            name: 'New Call',
            short_name: 'Call',
            description: 'Open the MigraVoice dialer.',
            url: '/dialer',
            icons: [{ src: 'migra-logo-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Call History',
            short_name: 'History',
            description: 'View recent calls.',
            url: '/calls',
            icons: [{ src: 'migra-logo-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
      injectManifest: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
    {
      name: 'migravoice-build-metadata',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'build.json',
          source: JSON.stringify(
            {
              app: 'MigraVoice',
              version: appVersion,
              buildSha,
              buildTime,
              releaseLabel,
            },
            null,
            2
          ),
        });
      },
    },
  ],
  // Base path - root for call.migrahosting.com
  base: '/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_SHA__: JSON.stringify(buildSha),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  server: {
    port: 3000,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
