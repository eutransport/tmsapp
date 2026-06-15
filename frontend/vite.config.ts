import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'icons/*.png', 'screenshots/*.png'],
      manifest: {
        name: 'TMS - Transport Management Systeem',
        short_name: 'TMS',
        description: 'Transport Management Systeem voor urenregistratie, planning en facturatie',
        theme_color: '#1e3a5f',
        background_color: '#1e3a5f',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        id: '/',
        icons: [
          {
            src: '/icons/icon-72x72.svg',
            sizes: '72x72',
            type: 'image/svg+xml',
            purpose: 'maskable any'
          },
          {
            src: '/icons/icon-96x96.svg',
            sizes: '96x96',
            type: 'image/svg+xml',
            purpose: 'maskable any'
          },
          {
            src: '/icons/icon-128x128.svg',
            sizes: '128x128',
            type: 'image/svg+xml',
            purpose: 'maskable any'
          },
          {
            src: '/icons/icon-144x144.svg',
            sizes: '144x144',
            type: 'image/svg+xml',
            purpose: 'maskable any'
          },
          {
            src: '/icons/icon-152x152.svg',
            sizes: '152x152',
            type: 'image/svg+xml',
            purpose: 'maskable any'
          },
          {
            src: '/icons/icon-192x192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'maskable any'
          },
          {
            src: '/icons/icon-384x384.svg',
            sizes: '384x384',
            type: 'image/svg+xml',
            purpose: 'maskable any'
          },
          {
            src: '/icons/icon-512x512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable any'
          }
        ],
        shortcuts: [
          {
            name: 'Urenregistratie',
            short_name: 'Uren',
            description: 'Registreer je gewerkte uren',
            url: '/time-entries',
            icons: [{ src: '/icons/icon-96x96.svg', sizes: '96x96' }]
          },
          {
            name: 'Planning',
            short_name: 'Planning',
            description: 'Bekijk de weekplanning',
            url: '/planning',
            icons: [{ src: '/icons/icon-96x96.svg', sizes: '96x96' }]
          }
        ],
        categories: ['business', 'productivity'],
        lang: 'nl',
        dir: 'ltr'
      },
      workbox: {
        // Increase max file size to cache - needed for large bundles
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB
        // Don't intercept /media/ and /api/ navigation requests with the SPA fallback
        navigateFallbackDenylist: [/^\/media\//, /^\/api\//],
        // Cache strategieën
        runtimeCaching: [
          {
            // Tracking/live API calls - Network only, never cache (real-time data)
            urlPattern: /^https?:\/\/.*\/api\/(tracking|fm-positions)\/.*/i,
            handler: 'NetworkOnly',
          },
          {
            // Other API calls - Network first, fallback to cache
            urlPattern: /^https?:\/\/.*\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24, // 24 uur
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
              networkTimeoutSeconds: 30, // Fallback to cache after 30s
            },
          },
          {
            // Media files - Cache first
            urlPattern: /^https?:\/\/.*\/media\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'media-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 dagen
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Google Fonts stylesheets
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
            },
          },
          {
            // Google Fonts webfont files
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 jaar
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Images
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 dagen
              },
            },
          },
        ],
        // Precache belangrijke routes
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Skip waiting en claim clients direct - crucial for iOS
        skipWaiting: true,
        clientsClaim: true,
        // Clean old caches on activate - helps iOS
        cleanupOutdatedCaches: true,
        // Navigation preload for faster page loads
        navigationPreload: true,
      },
      devOptions: {
        enabled: false, // Disabled - causes issues with API proxy
        type: 'module',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
      '/media': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
    },
  },
})
