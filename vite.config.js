import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/doc-make/',
  plugins: [react()],
  server: {
    allowedHosts: true,
  },
});
