import {
  expandBlocks,
  type FunctionBlockContent,
  functionBlockContentSchema,
  functionTemplateDraftSchema,
} from '@gptmaker/contracts';
import { SEED_BLOCKS, SEED_TEMPLATES } from '../../agent-functions';
import type { EvalTemplate } from './eval-case';

/** Formulário do seed usado pelos casos (o Suporte), já com os blocos expandidos. */
export function loadSeedTemplate(code = 'SUPPORT'): EvalTemplate {
  const seed = SEED_TEMPLATES.find((template) => template.code === code);
  if (!seed) throw new Error(`template do seed não encontrado: ${code}`);
  const blocks = new Map<string, FunctionBlockContent>(
    SEED_BLOCKS.map((block) => [block.code, functionBlockContentSchema.parse(block.content)]),
  );
  const { content } = expandBlocks(functionTemplateDraftSchema.parse(seed.draft), blocks);
  return { fields: content.fields, name: seed.name, description: seed.description };
}
