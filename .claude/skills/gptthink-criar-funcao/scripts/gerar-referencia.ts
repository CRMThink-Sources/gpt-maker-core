// Gera a referência da skill a partir do seed do repositório (design D19):
//   npx tsx .claude/skills/gptthink-criar-funcao/scripts/gerar-referencia.ts
// Reescreve referencia/blocos.json, exemplos/suporte.json e exemplos/sdr.json. O exemplo
// cobranca.json é escrito à mão e não é tocado. Rode depois de mudar um bloco ou um template do seed.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEED_BLOCKS, SEED_TEMPLATES } from '../../../../backend/src/modules/agent-functions/seed';

const skill = join(__dirname, '..');
const save = (path: string, value: unknown) =>
  writeFileSync(join(skill, path), `${JSON.stringify(value, null, 2)}\n`);

save(
  'referencia/blocos.json',
  SEED_BLOCKS.map((block) => ({ code: block.code, name: block.name, draft: block.content })),
);
for (const [code, file] of [
  ['SUPPORT', 'exemplos/suporte.json'],
  ['SDR', 'exemplos/sdr.json'],
] as const) {
  const template = SEED_TEMPLATES.find((item) => item.code === code)!;
  save(file, template);
}
console.log('referência da skill gerada a partir do seed');
