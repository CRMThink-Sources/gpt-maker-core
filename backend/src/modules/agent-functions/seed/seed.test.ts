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

describe('exemplos da revisão nos seeds', () => {
  const knowledge = SEED_TEMPLATES.flatMap((template) => {
    const { content } = expandBlocks(functionTemplateDraftSchema.parse(template.draft), blocks);
    return flattenFields(content.fields)
      .filter((field) => field.kind === 'KNOWLEDGE')
      .map((field) => [`${template.code} ${field.id}`, field] as const);
  });

  it('as bases dos quatro templates trazem exemplo bom e ruim', () => {
    const withExamples = knowledge.filter(([, field]) => field.review?.examples);
    // SDR (3), Suporte (3), Agendamento (3) e Pós-venda (3).
    expect(withExamples.length).toBeGreaterThanOrEqual(12);
  });

  it.each(knowledge.filter(([, field]) => field.kind === 'KNOWLEDGE' && field.review?.examples))(
    '%s: o exemplo bom usa os subcampos do campo, cabe nos limites e não tem marcador',
    (_name, field) => {
      if (field.kind !== 'KNOWLEDGE') return;
      const { good, bad } = field.review!.examples!;
      const byId = new Map(field.subfields.map((sub) => [sub.id, sub]));
      for (const example of [good, bad]) {
        expect(example).not.toContain('[preencher');
        for (const line of example.split('\n')) {
          const [key, ...rest] = line.split(': ');
          const sub = byId.get(key!);
          expect(sub, `${key} não é subcampo`).toBeDefined();
          expect(rest.join(': ').length).toBeLessThanOrEqual(sub!.maxLength);
        }
      }
      // O exemplo bom preenche todo subcampo obrigatório.
      const filled = new Set(good.split('\n').map((line) => line.split(': ')[0]));
      for (const sub of field.subfields) if (sub.required) expect(filled.has(sub.id)).toBe(true);
    },
  );
});

describe('ajuda da IA nos seeds', () => {
  const expanded = SEED_TEMPLATES.map((template) => {
    const { content } = expandBlocks(functionTemplateDraftSchema.parse(template.draft), blocks);
    return [template.code, flattenFields(content.fields), content.assist] as const;
  });

  it.each(expanded)(
    '%s: every default function with assist.enabled has at least one field with questions',
    (_code, fields, assist) => {
      expect(assist.enabled).toBe(true);
      expect(fields.some((field) => 'assist' in field && field.assist?.questions.length)).toBe(true);
    },
  );

  it.each(expanded)('%s: every seed field with assist is TEXT or TEXT_LIST', (_code, fields) => {
    for (const field of fields) {
      if ('assist' in field && field.assist) expect(['TEXT', 'TEXT_LIST']).toContain(field.kind);
    }
  });
});
