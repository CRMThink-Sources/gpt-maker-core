import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// Frontend tem configuração própria (eslint-config-next) em frontend/eslint.config.mjs.
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'frontend/**',
      'openspec/**',
      'openspec-crmthink-platform/**',
      'backend/drizzle/**',
      '**/*.config.*js',
      'backend/.dependency-cruiser.cjs',
      // Copiados/gerados do crmthink-platform (npm run sync -w @gptmaker/platform-sdk).
      'packages/platform-sdk/src/vendor/**',
      'packages/platform-sdk/src/api.gen.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    // Scripts utilitários rodam direto no Node.
    files: ['**/scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
  prettier,
);
