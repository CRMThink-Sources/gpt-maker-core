import {
  checkTemplate,
  expandBlocks,
  flattenFields,
  type FunctionBlockContent,
  functionBlockContentSchema,
  functionTemplateDraftSchema,
} from '@gptmaker/contracts';
import { describe, expect, it } from 'vitest';
import { SEED_BLOCKS, SEED_TEMPLATES } from './index';

const blocks = new Map<string, FunctionBlockContent>(
  SEED_BLOCKS.map((block) => [block.code, functionBlockContentSchema.parse(block.content)]),
);

/** Remove o critério de revisão de campos e subcampos, para comparar com o template sem ele. */
function withoutReview<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, inner) => (key === 'review' ? undefined : inner)));
}

const plainBlocks = new Map<string, FunctionBlockContent>(
  SEED_BLOCKS.map((block) => [
    block.code,
    functionBlockContentSchema.parse(withoutReview(block.content)),
  ]),
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

  it.each(SEED_TEMPLATES.map((template) => [template.code, template] as const))(
    '%s: todo campo da base traz o critério de revisão',
    (_code, template) => {
      const draft = functionTemplateDraftSchema.parse(template.draft);
      const { content } = expandBlocks(draft, blocks);
      const knowledge = flattenFields(content.fields).filter((field) => field.kind === 'KNOWLEDGE');
      expect(knowledge.length).toBeGreaterThan(0);
      for (const field of knowledge) {
        expect(field.review?.rubric, `${template.code} ${field.id}`).toBeTruthy();
      }
    },
  );

  it.each(SEED_TEMPLATES.map((template) => [template.code, template] as const))(
    '%s: o critério de revisão não muda o orçamento',
    (_code, template) => {
      const reviewed = expandBlocks(functionTemplateDraftSchema.parse(template.draft), blocks);
      const plain = expandBlocks(
        functionTemplateDraftSchema.parse(withoutReview(template.draft)),
        plainBlocks,
      );
      expect(reviewed.errors).toEqual([]);
      expect(plain.errors).toEqual([]);
      expect(checkTemplate(reviewed.content).budget).toEqual(checkTemplate(plain.content).budget);
    },
  );
});
