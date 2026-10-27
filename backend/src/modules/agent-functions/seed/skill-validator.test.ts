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
});
