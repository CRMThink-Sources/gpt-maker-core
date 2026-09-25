import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC emite metadados de decorators, necessários para a injeção de dependência do Nest.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          environment: 'node',
          testTimeout: 120_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
