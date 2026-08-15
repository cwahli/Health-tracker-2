import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      sourcemap: true,
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            // React core
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler|use-sync-external-store)[\\/]/.test(id)) {
              return 'vendor-react';
            }
            // Firebase SDK
            if (/[\\/]node_modules[\\/](@firebase|firebase)[\\/]/.test(id)) {
              return 'vendor-firebase';
            }
            // Charting
            if (/[\\/]node_modules[\\/](recharts|d3-|victory-)/.test(id)) {
              return 'vendor-charts';
            }
            // Maps
            if (/[\\/]node_modules[\\/](leaflet|react-leaflet)/.test(id)) {
              return 'vendor-maps';
            }
            // Lucide Icons
            if (/[\\/]node_modules[\\/]lucide-react/.test(id)) {
              return 'vendor-icons';
            }
          }
        }
      }
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR === 'true' ? false : true,
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    test: {
      exclude: ['**/node_modules/**', '**/dist/**', '**/studio/**', '**/archive/**'],
    },
  };
});
