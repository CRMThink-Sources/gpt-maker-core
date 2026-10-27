import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Testes de componente (jsdom); o Next não participa: os componentes testados são client-side.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
  },
});
