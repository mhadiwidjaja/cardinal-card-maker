/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileBridge } from './server/fileBridge.ts';

export default defineConfig({
  plugins: [react(), fileBridge()],
  server: { port: 5173, strictPort: true, host: 'localhost' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
  },
});
