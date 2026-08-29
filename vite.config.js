/** Vite build config. `base: './'` keeps asset URLs relative so the bundle loads from the
 *  Capacitor WebView (Android) as well as any static host; dev server behaviour is unchanged. */
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 1500 },
});
