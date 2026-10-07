import { defineConfig } from 'vite';

// Relative base so the build works both at the root of a domain and under a
// GitHub Pages project path (https://<user>.github.io/<repo>/).
export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 700 }, // three r128 is ~500 kB on its own
});
