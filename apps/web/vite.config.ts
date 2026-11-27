import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// In development, /api is proxied to the local API. In production, Netlify proxies /api/* to the
// API host (same first-party origin for REST); WebSockets connect directly to the API host.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // ws: true lets the signaling WebSocket (/api/v1/ws) through the same rule as REST.
    proxy: { '/api': { target: 'http://localhost:3000', ws: true } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
