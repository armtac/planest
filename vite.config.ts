import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png', '192.png', '512.png'],
      manifest: {
        name: 'Planest',
        short_name: 'Planest',
        description: 'PWA Action Plan con progressi gerarchici, calendario e reminder.',
        theme_color: '#f4f6fb',
        background_color: '#f4f6fb',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          { src: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json}'],
      },
    }),
  ],
})
