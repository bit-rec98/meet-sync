import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// In development, /api is proxied to the local API. In production, Netlify proxies /api/* to the
// API host (same first-party origin for REST); WebSockets connect directly to the API host.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: { environment: 'jsdom' },
});
