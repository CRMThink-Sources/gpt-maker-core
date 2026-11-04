import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  checkTemplate,
  expandBlocks,
  type FunctionBlockContent,
  functionBlockContentSchema,
  type FunctionTemplateDraftInput,
  functionTemplateDraftSchema,
} from '@gptmaker/contracts';
import { describe, expect, it } from 'vitest';
import { SEED_BLOCKS, SEED_TEMPLATES } from './index';

/**
 * A skill `gptthink-criar-funcao` (design D19) leva um validador sem dependências para uso fora
 * do repositório: ele tem de concordar com a checagem de publicação e com o seed.
 */
const SKILL = resolve(__dirname, '../../../../../.claude/skills/gptthink-criar-funcao');
const dir = mkdtempSync(join(tmpdir(), 'skill-'));

const blocks = new Map<string, FunctionBlockContent>(
  SEED_BLOCKS.map((block) => [block.code, functionBlockContentSchema.parse(block.content)]),
);

function validate(draft: FunctionTemplateDraftInput): { ok: boolean; output: string } {
  const file = join(dir, `${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(draft));
  try {
    const output = execFileSync('node', [join(SKILL, 'scripts/validar.mjs'), file], {
      encoding: 'utf8',
    });
    return { ok: true, output };
  } catch (error) {
    return { ok: false, output: String((error as { stdout?: string }).stdout ?? error) };
  }
}

function check(draft: FunctionTemplateDraftInput) {
  const { content } = expandBlocks(functionTemplateDraftSchema.parse(draft), blocks);
  return checkTemplate(content);
}

const worstCase = (output: string) =>
  Number(/pior caso do comportamento: (\d+)\//.exec(output)?.[1]);

describe('validador da skill de criação de funções', () => {
  it('blocos da referência iguais aos do seed', () => {
    const reference = JSON.parse(readFileSync(join(SKILL, 'referencia/blocos.json'), 'utf8'));
    expect(reference).toEqual(
      SEED_BLOCKS.map((block) => ({ code: block.code, name: block.name, draft: block.content })),
    );
  });

  it.each(SEED_TEMPLATES.map((template) => [template.code, template] as const))(
    '%s: aprovado com o mesmo pior caso da checagem',
    (_code, template) => {
      const result = validate(template.draft);
      expect(result.output).toContain('OK');
      expect(worstCase(result.output)).toBe(check(template.draft).budget.length);
    },
  );

  // Exemplos escritos com a skill (fora do seed): também têm de passar na checagem de publicação.
  it.each(['cobranca', 'recepcao', 'suporte-spa'])(
    'exemplo %s: aprovado com o mesmo pior caso',
    (name) => {
      const example = JSON.parse(readFileSync(join(SKILL, `exemplos/${name}.json`), 'utf8'));
      const result = validate(example.draft);
      expect(result.output).toContain('OK');
      expect(check(example.draft).errors).toEqual([]);
      expect(worstCase(result.output)).toBe(check(example.draft).budget.length);
    },
  );

  const support = SEED_TEMPLATES.find((template) => template.code === 'SUPPORT')!.draft;
  const withTransfer: FunctionTemplateDraftInput = {
    ...support,
    fields: [
      ...support.fields,
      { kind: 'BITRIX_USER', id: 'suporte.time', label: 'Time', required: true, multiple: true },
      { kind: 'BITRIX_OPENLINE', id: 'suporte.canal', label: 'Canal', required: false },
      { kind: 'AGENT', id: 'suporte.agente_vendas', label: 'Agente de vendas', required: true },
    ],
    intentions: [
      ...(support.intentions ?? []),
      {
        key: 'passar_time',
        name: 'Passar para o time',
        whenToUse: 'Quando o cliente pedir uma pessoa do time.',
        actions: [
          { type: 'TRANSFER_TO_HUMAN', config: { target: 'USER', userId: '{{suporte.time}}' } },
        ],
        instructions: 'Avise que alguém do time vai continuar.',
      },
      {
        key: 'passar_canal',
        name: 'Passar para o canal',
        whenToUse: 'Quando o assunto for de outro canal.',
        actions: [
          { type: 'TRANSFER_TO_HUMAN', config: { target: 'LINE', lineId: '{{suporte.canal}}' } },
        ],
        instructions: 'Avise que outro canal vai continuar.',
      },
    ],
    transfers: [
      {
        key: 'vendas',
        agent: '{{suporte.agente_vendas}}',
        instructions: 'Quando o cliente pedir orçamento.',
      },
    ],
  };

  it('vários usuários, canal aberto e transferência válidos', () => {
    expect(check(withTransfer).errors).toEqual([]);
    expect(validate(withTransfer).output).toContain('OK');
  });

  it('transferência sem campo de agente: os dois recusam', () => {
    const invalid = {
      ...withTransfer,
      transfers: [{ ...withTransfer.transfers![0]!, agent: '{{empresa.nome}}' }],
    };
    expect(check(invalid).errors).toContain('transferência vendas: escolha um campo de agente');
    const result = validate(invalid);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('transferência vendas: escolha um campo de agente');
  });

  it('item de SPA com valor que o campo não declara: os dois recusam', () => {
    const example = JSON.parse(readFileSync(join(SKILL, 'exemplos/suporte-spa.json'), 'utf8'));
    const draft = example.draft as FunctionTemplateDraftInput;
    const [intention] = draft.intentions!;
    const [spa, ...rest] = intention!.actions;
    const invalid: FunctionTemplateDraftInput = {
      ...draft,
      intentions: [
        {
          ...intention!,
          actions: [
            {
              ...spa!,
              config: {
                ...spa!.config,
                values: { ...(spa!.config.values as Record<string, string>), canal: 'x' },
              },
            },
            ...rest,
          ],
        },
      ],
    };
    const message = 'Abrir chamado: "canal" não é um valor de suporte.chamado';
    expect(check(invalid).errors).toContain(message);
    const result = validate(invalid);
    expect(result.ok).toBe(false);
    expect(result.output).toContain(message);
  });
});

describe('critério de revisão (review) na skill', () => {
  const sdr = SEED_TEMPLATES.find((template) => template.code === 'SDR')!.draft;
  type Raw = { id: string; subfields?: Array<{ id: string }> };

  /** Troca chaves de um campo do SDR (`fields` é `unknown[]` no tipo de entrada do schema). */
  const patched = (id: string, change: Record<string, unknown>): FunctionTemplateDraftInput => ({
    ...sdr,
    fields: sdr.fields.map((field) =>
      (field as Raw).id === id ? { ...(field as Raw), ...change } : field,
    ),
  });
  const withSubfieldReview = (review: unknown): FunctionTemplateDraftInput => ({
    ...sdr,
    fields: sdr.fields.map((field) => {
      const raw = field as Raw;
      if (raw.id !== 'base.produtos') return field;
      return {
        ...raw,
        subfields: raw.subfields!.map((sub) => (sub.id === 'descricao' ? { ...sub, review } : sub)),
      };
    }),
  });

  /** O schema da publicação e o validador da skill recusam com a mesma mensagem. */
  function refusedByBoth(draft: FunctionTemplateDraftInput, message: string) {
    const parsed = functionTemplateDraftSchema.safeParse(draft);
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.message)).toContain(message);
    const result = validate(draft);
    expect(result.ok).toBe(false);
    expect(result.output).toContain(message);
  }

  it('recomendado de itens acima do máximo: os dois recusam', () => {
    refusedByBoth(
      patched('base.produtos', { review: { recommendedItems: 16 } }),
      'base.produtos: o recomendado de itens da revisão (16) passa do máximo de itens do campo (15)',
    );
  });

  it('mínimo de texto acima do limite do campo: os dois recusam', () => {
    refusedByBoth(
      patched('sdr.perfil_ideal', { review: { minLength: 221 } }),
      'sdr.perfil_ideal: o mínimo da revisão (221) passa do limite de 220 caracteres do campo',
    );
  });

  it('mínimo do subcampo acima do limite dele: os dois recusam', () => {
    refusedByBoth(
      withSubfieldReview({ minLength: 901 }),
      'base.produtos.descricao: o mínimo da revisão (901) passa do limite de 900 caracteres do subcampo',
    );
  });

  it('chave que não vale para o tipo do campo: os dois recusam', () => {
    const draft = patched('sdr.perfil_ideal', { review: { recommendedItems: 1 } });
    expect(functionTemplateDraftSchema.safeParse(draft).success).toBe(false);
    const result = validate(draft);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('review.recommendedItems não vale para TEXT');
  });

  it('rubric acima de 500 caracteres: os dois recusam', () => {
    const draft = patched('base.produtos', { review: { rubric: 'x'.repeat(501) } });
    expect(functionTemplateDraftSchema.safeParse(draft).success).toBe(false);
    const result = validate(draft);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('review.rubric é um texto de até 500 caracteres');
  });

  it('examples válidos: os dois aceitam', () => {
    const draft = patched('base.produtos', {
      review: { examples: { good: 'nome: Plano\ndescricao: Bom.', bad: 'nome: X' } },
    });
    expect(functionTemplateDraftSchema.safeParse(draft).success).toBe(true);
    expect(validate(draft).ok).toBe(true);
  });

  it('examples malformados: os dois recusam', () => {
    const cases: Array<[unknown, string]> = [
      [{ good: 'só o bom' }, 'review.examples.bad é um texto de 1 a 400 caracteres'],
      [
        { good: 'x'.repeat(401), bad: 'y' },
        'review.examples.good é um texto de 1 a 400 caracteres',
      ],
      [{ good: 'a', bad: 'b', extra: 'c' }, 'review.examples.extra não existe'],
    ];
    for (const [examples, message] of cases) {
      const draft = patched('base.produtos', { review: { examples } });
      expect(functionTemplateDraftSchema.safeParse(draft).success).toBe(false);
      const result = validate(draft);
      expect(result.ok).toBe(false);
      expect(result.output).toContain(message);
    }
  });
});

describe('ajuda da IA (assist) na skill', () => {
  const sdr = SEED_TEMPLATES.find((template) => template.code === 'SDR')!.draft;
  type Raw = { id: string };
  const patched = (id: string, change: Record<string, unknown>): FunctionTemplateDraftInput => ({
    ...sdr,
    fields: sdr.fields.map((field) =>
      (field as Raw).id === id ? { ...(field as Raw), ...change } : field,
    ),
  });

  it('validator accepts assist on a text field', () => {
    const draft = patched('sdr.perfil_ideal', {
      assist: { questions: ['Quem é o seu cliente ideal?'], instructions: 'Seja breve.' },
    });
    expect(functionTemplateDraftSchema.safeParse(draft).success).toBe(true);
    expect(validate(draft).ok).toBe(true);
  });

  it('validator accepts assist on a KNOWLEDGE field', () => {
    const draft = patched('base.produtos', {
      assist: { questions: ['Que produtos vocês vendem?'], instructions: 'Um item por produto.' },
    });
    expect(functionTemplateDraftSchema.safeParse(draft).success).toBe(true);
    expect(validate(draft).ok).toBe(true);
  });

  it('validator accepts knowledgeMode skeleton and rejects an unknown mode', () => {
    const ok = {
      ...sdr,
      assist: { enabled: true, knowledgeMode: 'skeleton' },
    } as unknown as FunctionTemplateDraftInput;
    expect(functionTemplateDraftSchema.safeParse(ok).success).toBe(true);
    expect(validate(ok).ok).toBe(true);
    const bad = { ...sdr, assist: { enabled: true, knowledgeMode: 'tudo' } };
    expect(functionTemplateDraftSchema.safeParse(bad).success).toBe(false);
    const result = validate(bad as unknown as FunctionTemplateDraftInput);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('assist.knowledgeMode: write ou skeleton');
  });

  it('validator accepts assist on a text list field', () => {
    const draft = patched('sdr.perguntas', { assist: { questions: ['O que você quer saber?'] } });
    expect(functionTemplateDraftSchema.safeParse(draft).success).toBe(true);
    expect(validate(draft).ok).toBe(true);
  });

  it('validator rejects assist on a CHOICE field', () => {
    // O schema da publicação ignora a chave em silêncio; o validador da skill recusa de propósito.
    const draft = patched('sdr.qualificado', { assist: { questions: ['Pergunta?'] } });
    const result = validate(draft);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('assist não vale para CHOICE');
  });

  it('validator rejects 6 questions', () => {
    const draft = patched('sdr.perfil_ideal', {
      assist: { questions: ['a?', 'b?', 'c?', 'd?', 'e?', 'f?'] },
    });
    expect(functionTemplateDraftSchema.safeParse(draft).success).toBe(false);
    const result = validate(draft);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('assist.questions: de 1 a 5 perguntas');
  });

  it('validator rejects empty or long questions, long instructions and unknown keys', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ questions: [] }, 'assist.questions: de 1 a 5 perguntas'],
      [{ questions: ['  '] }, 'assist.questions: cada pergunta tem de 1 a 200 caracteres'],
      [
        { questions: ['x'.repeat(201)] },
        'assist.questions: cada pergunta tem de 1 a 200 caracteres',
      ],
      [
        { questions: ['a?'], instructions: 'x'.repeat(501) },
        'assist.instructions: texto de até 500 caracteres',
      ],
      [{ questions: ['a?'], extra: 1 }, 'assist.extra não existe'],
    ];
    for (const [assist, message] of cases) {
      const draft = patched('sdr.perfil_ideal', { assist });
      expect(functionTemplateDraftSchema.safeParse(draft).success).toBe(false);
      const result = validate(draft);
      expect(result.ok).toBe(false);
      expect(result.output).toContain(message);
    }
  });

  it('validator checks the template-level assist', () => {
    const ok = { ...sdr, assist: { enabled: true } };
    expect(functionTemplateDraftSchema.safeParse(ok).success).toBe(true);
    expect(validate(ok).ok).toBe(true);
    for (const assist of [{ enabled: 'sim' }, {}, true]) {
      const bad = { ...sdr, assist } as unknown as FunctionTemplateDraftInput;
      expect(functionTemplateDraftSchema.safeParse(bad).success).toBe(false);
      const result = validate(bad);
      expect(result.ok).toBe(false);
      expect(result.output).toContain('assist: precisa ser { enabled: true/false }');
    }
  });
});
