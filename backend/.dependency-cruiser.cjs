/** Fronteiras do monólito modular (design D1). */
module.exports = {
  forbidden: [
    {
      name: 'module-public-api-only',
      severity: 'error',
      comment: 'Um módulo só importa outro pelo index.ts (API pública) dele.',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/[^/]+/',
        pathNot: ['^src/modules/$1/', '^src/modules/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'shared-independent-of-modules',
      severity: 'error',
      comment: 'Infraestrutura comum não depende de módulos de domínio.',
      from: { path: '^src/shared/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-test-imports-in-src',
      severity: 'error',
      from: { path: '^src/', pathNot: '\\.test\\.ts$' },
      to: { path: '(\\.test\\.ts$|^test/)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '\\.test\\.ts$' },
  },
};
