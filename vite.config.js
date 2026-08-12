import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    /*
     * Proxy the API to the PHP dev server (npm run api).
     *
     * This keeps the browser on a single origin, which matters for two
     * reasons: the admin session cookie is SameSite=Lax and would be dropped
     * on a cross-origin request, and the API's own same-origin check would
     * reject the write. In production Apache serves both from one domain, so
     * this proxy makes development match deployment.
     */
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8123',
        changeOrigin: false,
      },
      // Note: /uploads is deliberately NOT proxied. Uploaded photos are written
      // into public/, which Vite already serves statically at that path.
    },
  },
});
