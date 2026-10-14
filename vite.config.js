import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: { port: 3002, host: true },
  preview: { port: 3002, host: true },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Groove Lab 3D — Visual Drummer',
        short_name: 'GrooveLab3D',
        description: 'Learn drums, read sheet music, master timing. Acoustic + electric kits, metronome games.',
        theme_color: '#0b0620',
        background_color: '#0b0620',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ]
});
