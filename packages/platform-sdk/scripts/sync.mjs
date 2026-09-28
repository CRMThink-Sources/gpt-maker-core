// Atualiza a cópia do contrato do crmthink-platform: OpenAPI e SDK TypeScript oficial.
// Uso: npm run sync -w @gptmaker/platform-sdk  (PLATFORM_REPO aponta para outro checkout)
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(pkg, '../..');
const platform = resolve(process.env.PLATFORM_REPO ?? resolve(repoRoot, '../crmthink-platform'));

const copies = [
  ['docs/api/openapi.json', resolve(repoRoot, 'docs/crmthink-platform-openapi.json')],
  ['sdk/typescript/index.ts', resolve(pkg, 'src/vendor/platform-sdk.ts')],
];

for (const [from, to] of copies) {
  const source = resolve(platform, from);
  if (!existsSync(source)) {
    console.error(`não encontrado: ${source} (defina PLATFORM_REPO)`);
    process.exit(1);
  }
  copyFileSync(source, to);
  console.log(`${from} → ${to}`);
}

execSync('npm run generate', { cwd: pkg, stdio: 'inherit' });
