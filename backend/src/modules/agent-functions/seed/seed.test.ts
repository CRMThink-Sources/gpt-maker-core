import {
  checkTemplate,
  expandBlocks,
  type FunctionBlockContent,
  functionBlockContentSchema,
  functionTemplateDraftSchema,
} from '@gptmaker/contracts';
import { describe, expect, it } from 'vitest';
import { SEED_BLOCKS, SEED_TEMPLATES } from './index';

const blocks = new Map<string, FunctionBlockContent>(
  SEED_BLOCKS.map((block) => [block.code, functionBlockContentSchema.parse(block.content)]),
);

describe('seed das funções', () => {
  it.each(SEED_TEMPLATES.map((template) => [template.code, template] as const))(
    '%s: válido e com pior caso dentro de 3000 caracteres',
    (_code, template) => {
      const draft = functionTemplateDraftSchema.parse(template.draft);
      const { content, errors } = expandBlocks(draft, blocks);
      expect(errors).toEqual([]);
      const check = checkTemplate(content);
      expect(check.errors).toEqual([]);
      expect(check.budget.length).toBeLessThanOrEqual(3000);
    },
  );
});
